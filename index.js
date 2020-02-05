const util = require('util')
// var FolderCapper = require('folder-capper')
const async = require('async')
const WebTorrent = require('webtorrent')
const events = require('events')
const parseTorrent = require('parse-torrent')
const fs = require('graceful-fs')
const createTorrent = require('create-torrent')
const hash = require('crypto-hashing')
const _ = require('lodash')

const FILEEXTENSION = '.dam'

const MetadataHandler = function (properties) {
  // Torrent setup
  this.announce = properties.client.announce
  this.urlList = properties.client.urlList

  // File system propertie
  this.dataDir = properties.folders.data
  this.torrentDir = properties.folders.torrents

  // Start the torrent Client
  this.client = new WebTorrent(properties.client)
}

util.inherits(MetadataHandler, events.EventEmitter)

const merge = function (torrent, cb) {
  const folderPath = torrent.path
  const fileArray = torrent.files
  const result = {}
  async.map(fileArray, (file, callback) => {
      const filePath = folderPath + '/' + file.path
      fs.readFile(filePath, (err, data) => {
        if (err) return callback(err)
        try {
          const jsonData = JSON.parse(data)
          return callback(null, jsonData)
        } catch (e) {
          return callback(e)
        }
      })
    }, (err, results) => {
      if (err) return cb(err)
      cb(null, _.merge(result, results))
    }
  )
}

const getHash = function (data) {
  if (!Buffer.isBuffer(data)) {
    data = Buffer.from(data)
  }
  var sha2 = hash.sha256(data)
  return sha2
}

const createNewMetaDataFile = function (data, name, folder, cb) {
  data = JSON.stringify(data)
  const fileName = name + FILEEXTENSION
  const filePath = folder + '/' + fileName
  fs.writeFile(filePath, data, (err) => {
    if (err) return cb(err)
    cb(null, {filePath: filePath, fileName: fileName})
  })
}

const createTorrentFromMetaData = function (params, cb) {
  const opts = {
    name: params.fileName,              // name of the torrent (default = basename of `path`)
    comment: 'DigiAssets Metadata',     // free-form textual comments of the author
    createdBy: 'DigiAssets-1.0.0',      // name and version of program used to create torrent
    announceList: params.announce,      // custom trackers (array of arrays of strings) (see [bep12](http://www.bittorrent.org/beps/bep_0012.html))
    creationDate: params.creationDate,  // creation time in UNIX epoch format (default = now)
    private: params.private,            // is this a private .torrent? (default = false)
    urlList: params.urlList,            // web seed urls (see [bep19](http://www.bittorrent.org/beps/bep_0019.html))
    pieceLength: params.pieceLength     // force a custom piece length (number of bytes)
  }
  createTorrent(params.filePath, opts, (err, torrent) => {
    if (err) return cb(err)
    const torrentObject = parseTorrent(torrent)
    const fileName = torrentObject.infoHash + '.torrent'
    const torrentPath = params.torrentDir + '/' + fileName
    const magnetURI = parseTorrent.toMagnetURI(torrentObject)
    fs.writeFile(torrentPath, torrent, (err) => {
      if (err) return cb(err)
      return cb(err, {torrent: torrentObject, fileName: fileName, filePath: torrentPath, magnetURI: magnetURI})
    })
  })
}

const getFileNameFromTorrent = function (torrentFileName, cb) {
  fs.readFile(torrentFileName, (err, data) => {
    if (err) return cb(err)
    let parsedTorrent
    try {
      parsedTorrent = parseTorrent(data)
    } catch (err) {
      return cb(err)
    }
    return cb(null, parsedTorrent.name)
  })
}

MetadataHandler.prototype.getMetadata = function (input, sha2, cb) {
  const opts = {
    announce: this.announce, // List of additional trackers to use (added to list in .torrent or magnet uri)
    path: this.dataDir,      // Folder where files will be downloaded (default=`/tmp/webtorrent/`)
    verify: true             // Verify previously stored data before starting (default=false)
  }
  this.client.add(input, opts, (torrent) => {
    torrent.on('done', () => {
      merge(torrent, (err, metadata) => {
        if (err) {
          this.emit('error', err)
          if (cb) cb(err)
        }
        if (sha2 && getHash(metadata) !== sha2) {
          err = new Error(input + ' has failed hash test')
          this.emit('error', err)
          if (cb) cb(err)
          return
        }
        this.emit('downloads/' + input, metadata)
        this.emit('downloads', metadata)
        if (cb) cb(null, metadata)
      })
    })
  })
}

MetadataHandler.prototype.addMetadata = function (metadata, cb) {
  let sha2
  if (Buffer.isBuffer(metadata)) {
    sha2 = getHash(metadata)
  } else {
    try {
      sha2 = getHash(JSON.stringify(metadata))
    } catch (e) {
      return cb(e)
    }
  }
  const fileName = sha2.toString('hex')
  async.waterfall([
    (callback) => {
      createNewMetaDataFile(metadata, fileName, this.dataDir, callback)
    }, (result, callback) => {
      result.torrentDir = this.torrentDir
      result.announce = this.announce
      result.urlList = this.urlList
      createTorrentFromMetaData(result, callback)
    }
  ], (err, result) => {
    if (err) return cb(err)
    cb(null, {torrentHash: Buffer.from(result.torrent.infoHash, 'hex'), sha2: sha2})
  })
}

MetadataHandler.prototype.shareMetadata = function (infoHash, cb) {
  const torrentFilePath = this.torrentDir + '/' + infoHash + '.torrent'
  getFileNameFromTorrent(torrentFilePath, (err, dataFileName) => {
    if (err) {
      this.emit('error', err)
      if (cb) cb(err)
      return
    }
    const dataFilePath = this.dataDir + '/' + dataFileName
    const opts = {
      name: dataFileName,                 // name of the torrent (default = basename of `path`)
      comment: 'DigiAssets Metadata',     // free-form textual comments of the author
      createdBy: 'DigiAssets-1.0.0',      // name and version of program used to create torrent
      announceList: this.announce,        // custom trackers (array of arrays of strings) (see [bep12](http://www.bittorrent.org/beps/bep_0012.html))
      urlList: this.urlList               // web seed urls (see [bep19](http://www.bittorrent.org/beps/bep_0019.html))
    }
    this.client.on('error', (err) => {console.error(err)})
    this.client.seed(dataFilePath, opts, (torrent) => {
      this.emit('uploads/' + infoHash, torrent)
      this.emit('uploads', torrent)
      if (cb) cb(null, torrent)
    })
  })
}

MetadataHandler.prototype.removeMetadata = function (infoHash, cb) {
  const torrentFilePath = this.torrentDir + '/' + infoHash + '.torrent'
  async.auto({
    removeTorrentFromClient: (cb) => {
      this.client.remove(infoHash, cb)
    },
    getDataFileName: ['removeTorrentFromClient', (cb) => {
      getFileNameFromTorrent(torrentFilePath, cb)
    }],
    deleteMetdataFile: ['getDataFileName', (cb, results) => {
      const dataFileName = results.getDataFileName
      const dataFilePath = this.dataDir + '/' + dataFileName
      fs.unlink(dataFilePath, cb)
    }],
    deleteTorrentFile: ['getDataFileName', (cb) => {
      fs.unlink(torrentFilePath, cb)
    }]
  }, (err) => {
    if (err) {
      this.emit('error', err)
      if (cb) cb(err)
      return
    }
    cb()
  })
}

module.exports = MetadataHandler
