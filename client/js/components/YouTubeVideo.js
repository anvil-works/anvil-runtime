"use strict";

var PyDefUtils = require("PyDefUtils");
var RSVP = require("rsvp");

/**
id: youtubevideo
docs_url: /docs/client/components/basic#youtube-video
title: YouTubeVideo
tooltip: Learn more about YouTubeVideo
description: |
  ```python
  ytv = YouTubeVideo(youtube_id="cbP2N1BQdYc", autoplay=True)
  ```

  You can display YouTube videos on your Anvil form with the YouTubeVideo component.

*/

module.exports = function(pyModule) {

    pyModule["YouTubeVideo"] = Sk.misceval.buildClass(pyModule, function($gbl, $loc) {

        var update = function(self) {
            var p = function(propname) {
                var v = self._anvil.props[propname];
                if (v === undefined) {
                    return undefined;
                } else {
                    return Sk.ffi.remapToJs(v);
                }
            };
            var np = function(propname) { return p(propname) ? "1" : "0"; };

            function YouTubeGetID(url) {
                var ID = '';
                url = url.replace(/(>|<)/gi,'').split(/(vi\/|v=|\/v\/|youtu\.be\/|\/embed\/)/);
                if(url[2] !== undefined) {
                    ID = url[2].split(/[^0-9a-z_\-]/i);
                    ID = ID[0];
                } else {
                    ID = url;
                }
                return ID;
            }

            var vid = YouTubeGetID(p("youtube_id"));

            // If we want to loop, we must also set the 'playlist' parameter to the ID of the video. See https://developers.google.com/youtube/player_parameters?hl=en
            self._anvil.element.find("iframe").attr("src", "https://www.youtube.com/embed/" + encodeURIComponent(vid) +
                                                           "?rel=0&enablejsapi=1&autoplay=" + np("autoplay") + "&loop=" + np("loop") + (p("loop") ? ("&playlist=" + encodeURIComponent(p("youtube_id"))) : ""));
        };

        var properties = PyDefUtils.assembleGroupProperties(/*!componentProps(YouTubeVideo)!1*/["layout", "height", /*"interaction",*/ "appearance", "user data"], {
            height: {defaultValue: 300},
        });

        properties.push(/*!componentProp(YouTubeVideo)!1*/{
            name: "youtube_id", type: "string",
            defaultValue: "",
            exampleValue: "m7kzwpJfEeY",
            description: "The ID of the YouTube video to play",
            suggested: true,
            set: function(s) { update(s); }
        });

        properties.push(/*!componentProp(YouTubeVideo)!1*/{
            name: "autoplay", type: "boolean",
            defaultValue: false,
            description: "Set to true to play this video immediately",
            set: function(s) { update(s); }
        });

        properties.push(/*!componentProp(YouTubeVideo)!1*/{
            name: "loop", type: "boolean", defaultValue: false,
            description: "Set to true to play this video repeatedly",
            set: function(s) { update(s); }
        });

        properties.push(/*!componentProp(YouTubeVideo)!1*/{
            name: "current_time",
            type: "object",
            description: "Get or set the current playback position, in seconds.",
            exampleValue: 10.2,
            set: function(s,e,v) {
                if (s._anvil.player && s._anvil.player.seekTo) {
                    s._anvil.player.seekTo(v,true);
                }
            },
            get: function(s,e) {
                if (s._anvil.player && s._anvil.player.getCurrentTime) {
                    return s._anvil.player.getCurrentTime();
                }
                return 0;
            }
        })

        properties.push(/*!componentProp(YouTubeVideo)!1*/{
            name: "volume",
            type: "object",
            description: "Get or set the current volume, from 0 - 100.",
            exampleValue: 50,
            set: function(s,e,v) {
                if (s._anvil.player && s._anvil.player.setVolume && v != null) {
                    s._anvil.player.setVolume(v);
                }
            },
            get: function(s,e) {
                if (s._anvil.player && s._anvil.player.getVolume) {
                    return s._anvil.player.getVolume();
                } else {
                    return 0;
                }
            }
        });

        let translateState = (state) => {
            switch(state) {
                case -1:
                    return "UNSTARTED";
                case 0:
                    return "ENDED";
                case 1:
                    return "PLAYING";
                case 2:
                    return "PAUSED";
                case 3:
                    return "BUFFERING";
                case 5:
                    return "CUED";
                default:
                    return "UNKNOWN";
            };
        };

        properties.push(/*!componentProp(YouTubeVideo)!1*/{
            name: "state",
            type: "object",
            description: "Get the current playback state of the video as a string. E.g. PLAYING",
            readOnly: true,
            get: function(s,e) {
                if (s._anvil.player && s._anvil.player.getPlayerState) {
                    var state = s._anvil.player.getPlayerState();
                }

                return translateState(state);
            }
        });

        properties.push(/*!componentProp(YouTubeVideo)!1*/{
            name: "duration",
            type: "object",
            description: "Get the duration of the video in seconds.",
            readOnly: true,
            get: function(s,e) {
                if (s._anvil.player && s._anvil.player.getDuration) {
                    return s._anvil.player.getDuration();
                } else {
                    return 0;
                }
            }
        });

        properties.push(/*!componentProp(YouTubeVideo)!1*/ {
            name: "mute",
            type: "boolean",
            description: "Set whether the video is muted or not.",
            defaultValue: false,
            set: function(s,e,v) {
                if (s._anvil.player && s._anvil.player.mute && s._anvil.player.unMute) {
                    if (v) {
                        s._anvil.player.mute();
                    } else {
                        s._anvil.player.unMute();
                    }
                }
            },
        });

        var events = PyDefUtils.assembleGroupEvents(/*!componentEvents()!3*/ "YouTubeVideo", ["universal", "user data"],
                                                    {show: {description: "When this video is shown on the screen (or it is added to a visible form)"},
                                                     hide: {description: "When this video is hidden from the screen (or it is removed from a visible form)"}});

        /*!componentEvent(YouTubeVideo)!1*/
        events.push({name: "state_change",
                     description: "When the video changes state (eg PAUSED to PLAYING)",
                     parameters: [{
                        name: "state",
                        type: "string",
                        description: "The new state of the video (values from the YouTube API)",
                        important: true,
                     }],
                     important: true,
                     defaultEvent: true});


        $loc["__init__"] = PyDefUtils.mkInit(function init(self, kwargs) {
            self._anvil.element = $("<div/>").css({
                minHeight: 34,
            }).addClass("anvil-youtube-video").append($('<iframe enablejsapi=true frameborder="0" allowfullscreen></iframe>').width("100%").height("100%"));
            self._anvil.dataBindingProp = "youtube_id";

            self._anvil.playerDefer = RSVP.defer();
            self._anvil.player = null;

            if (!self._inDesigner) {
                setTimeout(function load() {
                    if (window.YT && window.YT.Player) {
                        self._anvil.player = new YT.Player(self._anvil.element.find("iframe")[0], {
                            events: {
                                onReady: function() {
                                    if (kwargs["mute"]) {
                                        self._anvil.player.mute();
                                    }
                                    self._anvil.playerDefer.resolve(self._anvil.player);
                                },
                                onStateChange: function(e) {
                                    PyDefUtils.raiseEventAsync({state: translateState(e.data)}, self, "state_change");
                                },
                            },
                        });
                    } else {
                        console.log("YouTube Player not yet loaded. Trying again in 1 sec.");
                        setTimeout(load, 1000);
                    }

                }, 0)
            }
        }, pyModule, $loc, properties, events, pyModule["Component"]);

        /*!defMethod(_)!2*/ "Start playing this YouTube video"
        $loc["play"] = new Sk.builtin.func(function(self) {
            self._anvil.playerDefer.promise.then(p => p.playVideo());
        });

        /*!defMethod(_)!2*/ "Pause this YouTube video"
        $loc["pause"] = new Sk.builtin.func(function(self) {
            self._anvil.playerDefer.promise.then(p => p.pauseVideo());
        });

        /*!defMethod(_)!2*/ "Stop playing this YouTube video"
        $loc["stop"] = new Sk.builtin.func(function(self) {
            self._anvil.playerDefer.promise.then(p => p.stopVideo());
        });


    }, /*!defClass(anvil,YouTubeVideo,Component)!*/ 'YouTubeVideo', [pyModule["Component"]]);
};

/*
 * TO TEST:
 *
 *  - Prop groups: layout, interaction, height, appearance
 *  - New props: youtube_id, autoplay, loop
 *
 */
