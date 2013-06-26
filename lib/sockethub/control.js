#!/usr/bin/env node
require("consoleplusplus/console++");
var cluster = require('cluster');
var util = require('./util.js');
var listener;
var initDispatcher = false;
var dispatcher;
var sockethubId = Math.floor((Math.random()*10)+1) + new Date().getTime();
var config = require('./../../config.js').config;

function run(config) {
  var i = 0;
  var _console = {
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
    log: console.log
  };

  if (cluster.isMaster) {
    /** MASTER **/

    var shuttingDown = false;

    if (typeof(config.NUM_WORKERS) === 'undefined') {
      // have 2 workers by default, so when one dies clients can reconnect
      // immediately without waiting for the new worker to boot up.
      config.NUM_WORKERS = 2;
    }

    for (i = 0; i < config.NUM_WORKERS; i++) {
      cluster.fork();
    }

    cluster.on('disconnect', function (worker) {
      if (shuttingDown) {
        console.info("Worker " + worker.id + " done.");
      } else {
        console.error("Worker " + worker.id + " disconnected, spawning new one.");
        cluster.fork();
      }
    });

    cluster.on('exit', function (worker, code, signal) {

      if (code === 1) {
        console.info('worker exited '+code+' ... shutting down');
        shuttingDown = true;
      }

      if (worker.suicide) {
        console.log('worker exited '+code+' '+signal);
      }
    });

    process.on('SIGINT', function () {
      console.log("\nCaught SIGINT (Ctrl+C)");
      console.info("Sockethub is shutting down...");

      shuttingDown = true;

      for (var id in cluster.workers) {
        console.info("Sending 'shutdown' message to worker " + id);
        cluster.workers[id].send('shutdown');
      }
    });

    process.on('SIGILL', function () {
      console.log("\nCaught SIGILL (kill -9)");
      console.info("Sockethub is shutting down...");

      shuttingDown = true;

      for (var id in cluster.workers) {
        console.info("Sending 'shutdown' message to worker " + id);
        cluster.workers[id].send('shutdown');
      }
    });


  } else if (cluster.isWorker) {
    /** WORKER **/

    // wrap the console functions to prepend worker id
    console.info = function (msg, dump) {
      _console.info.apply(this, ['[worker #'+cluster.worker.id+'] '+msg, (dump) ? dump : '']);
    };
    console.error = function (msg, dump) {
      _console.error.apply(this, ['[worker #'+cluster.worker.id+'] '+msg, dump]);
    };
    console.debug = function (msg, dump) {
      _console.debug.apply(this, ['[worker #'+cluster.worker.id+'] '+msg, (dump) ? dump : '']);
    };
    console.warn = function (msg, dump) {
      _console.warn.apply(this, ['[worker #'+cluster.worker.id+'] '+msg, (dump) ? dump : '']);
    };
    console.log = function (msg, dump) {
      _console.log.apply(this, ['[worker #'+cluster.worker.id+'] '+msg, (dump) ? dump : '']);
    };

    process.on('uncaughtException', function(err) {
      console.log('Caught exception: ' + err);
      if (err.stack) {
        console.log(err.stack);
      }
      if (err.exit) {
        process.exit(1);
      } else {
        process.exit();
      }
    });

    process.on('SIGINT', function () {
      console.log("\nworker: caught SIGINT (Ctrl+C)");
      // we catch the sigint in the worker thread but ignore it so that
      // does not abort our process. we'll be able to gracefully shut down
      // when we get the command from the master.
    });
    process.on('SIGILL', function () {
      console.log("\nworker: caught SIGILL (kill -9)");
      // we catch the sigkill in the worker thread but ignore it so that
      // does not abort our process. we'll be able to gracefully shut down
      // when we get the command from the master.
    });

    cluster.worker.on('message', function (message) {
      if (message === 'shutdown') {
        console.info("Cleaning up listener sessions...");
        if (initDispatcher) {
          dispatcher.shutdown().then(function () {
            console.info("Exiting...");
            console.log("\n");
          }, function (err) {
            console.error('Aborting...'+err);
            console.log("\n");
          });
        }
        util.redis.clean(sockethubId, function (err) {
          process.exit(1);
        });
      } else {
        console.error("Huh? Someone sent an unexpected message to this worker process: " + message);
      }
    });


    var proto;
    // load in protocol.js (all the schemas) and perform validation
    try {
      proto = require("./protocol.js");
    } catch (e) {
      throw new util.SockethubError('unable to load lib/sockethub/protocol.js ' + e, true);
    }



    // initialize listeners
    if (config.HOST.MY_PLATFORMS.length > 0) {
      listener = require('./listener');
    }

    for (i = 0, len = config.HOST.MY_PLATFORMS.length; i < len; i = i + 1) {
      if (config.HOST.MY_PLATFORMS[i] === 'dispatcher') {
        initDispatcher = true;
        continue;
      }
      console.debug(' [bootstrap] initializing listener for '+config.HOST.MY_PLATFORMS[i]);
      try {
        var l  = listener();
        l.init({
          platform: proto.platforms[config.HOST.MY_PLATFORMS[i]],
          sockethubId: sockethubId
        });
      } catch (e) {
        console.error('failed initializing '+config.HOST.MY_PLATFORMS[i]+' platform: ', e);
        process.exit(1);
      }
    }

    // intiialize dispatcher
    if (initDispatcher) {
      try {
        dispatcher = require('./dispatcher.js');
      } catch (e) {
        console.error('unable to load lib/sockethub/dispatcher.js : ' + e);
        process.exit(1);
      }

      dispatcher.init(config.HOST.MY_PLATFORMS, sockethubId, proto).then(function () {
        var server;
        try {
          // initialize http server
          server = require('./../servers/http').init(config);
        } catch (e) {
          console.error('unable to load lib/servers/http ' + e);
          process.exit(1);
        }

        var wsServer;
        try {
          // initialize websocket server
          wsServer = require('./../servers/websocket').init(config, server, dispatcher);
        } catch (e) {
          console.error('unable to load lib/servers/websocket ' + e);
          process.exit(1);
        }

        console.info(' [*] finished loading' );
        console.log("\n");
      }, function (err) {
        console.error(" [sockethub] dispatcher failed initialization, aborting");
        process.exit(1);
      });

    } else {
      console.info(' [sockethub] finished loading listeners. ready to work boss!');
    }
  }
}

run(config);