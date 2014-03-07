/**
 * This file is part of sockethub.
 *
 * © 2012-2013 Nick Jennings (https://github.com/silverbucket)
 *
 * sockethub is licensed under the AGPLv3.
 * See the LICENSE file for details.
 *
 * The latest version of sockethub can be found here:
 *   git://github.com/sockethub/sockethub.git
 *
 * For more information about sockethub visit http://sockethub.org/.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 */

var Twit = require('twit');
var Q = require('q');

var Twitter = function () {
  var pub = {};
  var session;

  pub.schema = {
    "set": {
      "additionalProperties": false,
      "properties" : {
        "credentials" : {
          "name": "credentials",
          "type": "object",
          "required": false,
          "additionalProperties": false,
          "patternProperties" : {
            ".+": {
              "type": "object",
              "required": true,
              "additionalProperties": false,
              "properties": {
                "actor": {
                  "type": "object",
                  "required": false,
                  "additionalProperties": false,
                  "properties" : {
                    "name" : {
                      "name" : "name",
                      "required" : false,
                      "type": "string"
                    },
                    "address" : {
                      "name" : "address",
                      "required" : false,
                      "type": "string"
                    }
                  }
                },
                "consumer_key" : {
                  "name" : "consumer_key",
                  "required" : true,
                  "type": "string"
                },
                "consumer_secret" : {
                  "name" : "consumer_secret",
                  "required" : true,
                  "type": "string"
                },
                "access_token" : {
                  "name" : "access_token",
                  "required" : true,
                  "type": "string"
                },
                "access_token_secret" : {
                  "name" : "access_token_secret",
                  "required" : true,
                  "type": "string"
                }
              }
            }
          }
        }
      }
    }
  };

  function mapProperties (data) {
    //session.log('mapProperties() j: '+ JSON.stringify(data));
    var obj = {
      actor: {},
      target: [],
      object: {}
    };

    try {
      obj.actor.address = data.user.screen_name;
      obj.actor.name = data.user.name;
      obj.actor.id = data.user.id;
      obj.actor.image = data.user.profile_image_url_https;

      // collect mentions
      for (var i = 0, num = data.entities.user_mentions.length; i < num; i = i + 1) {
        obj.target.push({
          address: data.entities.user_mentions[i].screen_name,
          id: data.entities.user_mentions[i].id,
          name: data.entities.user_mentions[i].name,
          type: "cc"
        });
      }

      // collect tags
      obj.object.tags = [];
      for (i = 0, num = data.entities.hashtags.length; i < num; i = i + 1) {
        obj.object.tags.push(data.entities.hashtags[i].text);
      }

      // collect urls
      obj.object.urls = [];
      for (i = 0, num = data.entities.urls.length; i < num; i = i + 1) {
        obj.object.urls.push(data.entities.urls[i].expanded_url);
      }

      obj.object.text = data.text;
      obj.object.date = data.created_at;
      obj.object.id = data.id;
      obj.object.id_str = data.id_str;
      obj.object.source = data.source;
    } catch (e) {
      console.log('twitter - failed mapping properties: ', e);
      obj = e.toString();
    }
    // /session.log('mapProperties return: '+obj);
    return obj;
  }


  function initTwit(creds) {
    if ((!creds.consumer_key) ||
        (!creds.consumer_secret) ||
        (!creds.access_token) ||
        (!creds.access_token_secret)) {
      return "twitter credentials incomplete";
    } else {
      try {
        return new Twit({
          consumer_key: creds.consumer_key,
          consumer_secret: creds.consumer_secret,
          access_token: creds.access_token,
          access_token_secret: creds.access_token_secret
        });
      } catch (e) {
        console.log('twitter - failed init: ',e);
        return e.toString();
      }
    }
  }

  pub.init = function (s) {
    var q = Q.defer();
    session = s;
    q.resolve();
    return q.promise;
  };


  pub.fetch = function (job) {
    session.log('fetch');
    var q = Q.defer();
    try {
      session.getConfig('credentials').then(function (creds) {
        if (!creds[job.actor.address]) {
          q.reject('unable to get credentials for ' + job.actor.address);
        }
        session.log('got credentials for ' + job.actor.address);

        var twit = initTwit(creds[job.actor.address]);
        if (typeof twit === 'string') {
          q.reject(twit);
        }

        var endpoint;
        if ((job.target) && (typeof job.target.length !== 'undefined') && (job.target.length >= 1)) {
          // currently just support for first target specified
          if (job.target[0].address === 'user_timeline') {
            // we dont know the username but want the users tweets
            endpoint = 'user_timeline';
          } else {
            endpoint = 'statuses/'+job.target[0].address+'_timeline';
          }
        } else {
          // no target set, use homefeed
          endpoint = 'statuses/home_timeline';
        }

        if ((job.object) && (job.object.poll)) {
          // ongoing stream
          var stream = twit.stream(endpoint);

          stream.on('tweet', function (tweet) {
            session.debug('** got tweet: ', tweet);
            var obj = mapProperties(tweet);
            if (typeof obj === 'string') {
              console.error("error normalizing tweet: "+e);
            } else {
              obj.verb = 'post';
              obj.status = true;
              session.send(obj);
            }
          });
          q.resolve(null, true);
        } else {
          // one-time fetch
          twit.get(endpoint, {}, function (err, replies) {
            if (err) {
              q.reject(err);
            }
            if ((replies) && (typeof replies.length !== 'undefined')) {
              for (var i = 0, num = replies.length; i < num; i = i + 1) {
                var obj = mapProperties(replies[i]);
                if (typeof obj === 'string') {
                  console.error("error normalizing tweet: "+obj);
                } else {
                  obj.verb = 'post';
                  obj.status = true;
                  session.send(obj);
                  q.resolve();
                }
              }
            } else {
              q.resolve({'message': 'no tweets found.'});
            }
          });
        }

      }, function (e) {
        session.log('failed getting credentials: '+e);
        q.reject(e);
      });
    } catch (e) {
      q.reject(e);
    }
    return q.promise;
  };


  pub.post = function (job) {
    var q = Q.defer();
    try {
      session.getConfig('credentials').then(function (creds) {
        if (!creds[job.actor.address]) {
          q.reject('unable to get credentials for ' + job.actor.address);
        }
        session.log('got credentials for ' + job.actor.address);
        var twit = initTwit(creds[job.actor.address]);
        if (typeof twit === 'string') {
          q.reject(twit);
        } else {
          twit.post('statuses/update', { status: job.object.text }, function(err, reply) {
            if (err) {
              console.debug('Tweeting failed: ', err.data);
              var errmsg = '';
              if (err.data) {
                errmsg = err.data;
              } else if (typeof err === 'string') {
                errmsg = 'twitting failed: ' + err;
              } else {
                errmsg = 'twitting failed, no information given: ' + err;
              }
              q.reject(errmsg);
            } else {
              var obj = mapProperties(reply);
              if (typeof obj === "string") {
                session.error('PROBLEM ASSIGNING PROPERTIES: ' + obj);
                q.reject(obj);
              } else {
                q.resolve(obj.object);
              }
            }
          });
        }
      }, function (e) {
        q.reject(e);
      });
    } catch(e) {
      q.reject(e);
    }
    return q.promise;
  };


  pub.cleanup = function() {
    var q = Q.defer();
    q.resolve(); // cleanup not implemented yet
    return q.promise;
  };

  return pub;
};

module.exports = Twitter;
