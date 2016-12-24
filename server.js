
var EventEmitter = require('events').EventEmitter
var util = require('util')
var debug = require('debug')('websocket-server')
var protobuf = require('protocol-buffers')
var WSPacket = protobuf(require('sendy-protobufs').ws).Packet
var http = require('http')
var typeforce = require('typeforce')
var omit = require('object.omit')
var extend = require('xtend')
var io = require('socket.io')

function Server (opts) {
  var self = this

  typeforce({
    port: '?Number',
    path: '?String',
    server: '?Object'
  }, opts)

  EventEmitter.call(this)

  this._hosts = {}
  this._sockets = {}
  this._server = opts.server
  if (!this._server) {
    if (!opts.port) throw new Error('expected "server" or "port"')

    this._server = http.createServer(function (req, res) {
      res.writeHead(500)
      res.end('This is a websockets endpoint!')
    })

    this._server.listen(opts.port)
  }

  const ioOpts = extend(omit(opts, ['path', 'server', 'port']), { path: opts.path || '/' })
  this._io = io(this._server, ioOpts)
  this._io.on('connection', function (socket) {
    self._onconnection(socket)
  })
}

util.inherits(Server, EventEmitter)
module.exports = Server

Server.prototype._onconnection = function (socket) {
  var self = this
  var query = socket.request._query
  var handle = query.from
  if (!handle) {
    debug('disconnecting socket without `handle` query param in connection request url')
    return socket.disconnect()
  }

  register()
  socket.once('disconnect', ondisconnect)
  socket.on('error', onerror)
  socket.on('message', onmessage)

  function register () {
    // TODO: handshake to weed out pretenders
    if (self._sockets[handle]) return

    debug('registered ' + handle)
    self._sockets[handle] = socket
    self.emit('connect', handle)
  }

  function onerror (err) {
    debug('disconnecting, socket for client ' + handle + ' experienced an error', err)
    socket.disconnect()
  }

  function ondisconnect () {
    if (self._destroyed || !handle) return

    debug(handle + ' disconnected')
    try {
      delete self._sockets[handle]
    } catch (err) {
    }

    handle = null
    self.emit('disconnect', handle)
    socket.removeListener('error', onerror)
    socket.removeListener('message', onmessage)
    socket.once('connect', function () {
      // is this even possible?
      debug('socket reconnected!')
      self._onconnection(socket)
    })
  }

  function onmessage (msg) {
    try {
      msg = WSPacket.decode(msg)
    } catch (err) {
      return socket.emit('error', { message: 'invalid message', data: msg })
    }

    // in case the socket disconnected and reconnected
    register()
    if (handle === msg.to) {
      return debug('refusing to send message to its own sender')
    }

    debug('got message from ' + handle + ' to ' + msg.to + ' with length ' + msg.data.length)
    if (!self.hasHost(msg.to)) {
      return socket.emit('404', msg.to)
    }

    if (msg.data) {
      self.emit('message', { from: handle, to: msg.to, data: msg.data })
    }
  }
}

Server.prototype.send = function ({ data, from, to }) {
  const socket = this.getClient(to)
  if (!socket) throw new Error(`client ${to} not found`)

  socket.emit('message', WSPacket.encode({ from, data }))
}

Server.prototype.addHost = function (identifier) {
  this._hosts[identifier] = true
}

Server.prototype.removeHost = function (identifier) {
  delete this._hosts[identifier]
}

Server.prototype.getConnectedClients = function () {
  return Object.keys(this._sockets)
}

Server.prototype.getClient = function (handle) {
  return this._sockets[handle]
}

Server.prototype.hasClient = function (handle) {
  return handle in this._sockets
}

Server.prototype.hasHost = function (handle) {
  return handle in this._hosts
}

Server.prototype.destroy = function (cb) {
  if (this._destroyed) return process.nextTick(cb)

  this._destroyed = true
  debug('destroying')

  for (var handle in this._sockets) {
    this._sockets[handle].disconnect(true)
    // s.removeAllListeners()
  }

  delete this._sockets
  this._io.close()
  this._server.close()
  if (cb) process.nextTick(cb)
}
