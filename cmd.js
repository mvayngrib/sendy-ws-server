#!/usr/bin/env node

const server = require('./')
const port = Number(process.argv[2]) || 42824
const server = new Server({ port })
console.log('running on port ' + port)
