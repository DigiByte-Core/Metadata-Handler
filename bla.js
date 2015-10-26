var WebTorrent = require('webtorrent')

var torrentProperties = {
  client: {
    announce: [['udp://tracker.openbittorrent.com:80', 'udp://open.demonii.com:1337', 'udp://tracker.coppersurfer.tk:6969', 'udp://tracker.leechers-paradise.org:6969']]
  }
}

var client = new WebTorrent(torrentProperties)

var file = __dirname + '/data/spv/a.ccm'
// When user drops files on the browser, create a new torrent and start seeding it!
client.seed(file, function onTorrent (torrent) {
  // Client is seeding the file!
  console.log(torrent.magnetURI)
})