var EventEmitter = require('events').EventEmitter
var extend = require('xtend')
var typeforce = require('typeforce')
var protobuf = require('protocol-buffers')
var once = require('once')
var reemit = require('re-emitter')
var Sendy = require('sendy')
var Switchboard = Sendy.Switchboard
var Packet = protobuf(require('sendy-protobufs').ws).Packet

module.exports = function switchboard (opts) {
  typeforce({
    identifier: typeforce.String,
    server: typeforce.Object
  }, opts)

  var server = opts.server
  var identifier = opts.identifier
  var unreliable = new EventEmitter()
  unreliable.destroy = once(function () {
    unreliable.emit('destroy')
  })

  unreliable.send = function ({ from, to, data }) {
    if (server.hasClient(to) || server.hasHost(to)) {
      server.send({ from, to, data })
    }
  }

  server.addHost(identifier)
  server.on('message', function ({ from, to, data }) {
    if (to === identifier) {
      unreliable.emit('receive', { from, data })
    }
  })

  reemit(unreliable, server, ['connect', 'disconnect'])

  return new Switchboard(extend({
    encode: encode,
    unreliable: unreliable,
    clientForRecipient: getDefaultClientForRecipient
  }, opts))

  function encode (data, to) {
    return { from: identifier, to, data }
  }
}

function decode (msg) {
  if (msg instanceof ArrayBuffer) msg = new Buffer(msg)

  return Packet.decode(msg)
}

function getDefaultClientForRecipient () {
  return new Sendy()
}
