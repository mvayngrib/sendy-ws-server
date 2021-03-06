
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
  socket.on('presence', onpresence)

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
    socket.removeListener('presence', onpresence)
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
    self.send({
      from: handle,
      to: msg.to,
      data: msg.data
    }, socket)
  }

  function onpresence () {
    self._announcePresence(socket)
  }
}

Server.prototype._announcePresence = function (socket) {
  const sockets = socket ? [socket] : values(this._sockets)
  const identifiers = this.getConnectedHosts()
  sockets.forEach(function (s) {
    s.emit('presence', identifiers)
  })
}

Server.prototype.send = function (msg, fromSocket) {
  const { data, from, to } = msg
  if (this.hasHost(to)) {
    this.emit('message', msg)
  } else if (this.hasClient(to)) {
    this.getClient(to).emit('message', WSPacket.encode({ from, data }))
  } else {
    if (fromSocket) {
      fromSocket.emit('404', to)
    } else {
      throw new Error(`client ${to} not found`)
    }
  }
}

Server.prototype.addHost = function (identifier) {
  this._hosts[identifier] = true
  this._broadcastPresence()
}

Server.prototype.removeHost = function (identifier) {
  delete this._hosts[identifier]
  this._broadcastPresence()
}

Server.prototype._broadcastPresence = function () {
  // debounce
  clearTimeout(this._broadcastPresenceTimeout)
  this._broadcastPresenceTimeout = setTimeout(this._announcePresence.bind(this), 1)
  if (this._broadcastPresenceTimeout.unref) this._broadcastPresenceTimeout.unref()
}

Server.prototype.getConnectedClients = function () {
  return Object.keys(this._sockets)
}

Server.prototype.getConnectedHosts = function () {
  return Object.keys(this._hosts)
}

Server.prototype.getClient = function (handle) {
  return this._sockets[handle]
}

Server.prototype.hasClient = function (handle) {
  return handle in this._sockets
}

Server.prototype.getHost = function (handle) {
  return this._hosts[handle]
}

Server.prototype.hasHost = function (handle) {
  return handle in this._hosts
}

Server.prototype.destroy = function (cb) {
  if (this._destroyed) return process.nextTick(cb)

  this._destroyed = true
  this.emit('destroy')
  debug('destroying')

  for (var handle in this._sockets) {
    this._sockets[handle].disconnect(true)
    // s.removeAllListeners()
  }

  this._sockets = {}
  this._io.close()
  this._server.close()
  if (cb) process.nextTick(cb)
}

function values (obj) {
  return Object.keys(obj).map(function (key) {
    return obj[key]
  })
}
