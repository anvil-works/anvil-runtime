"use strict";

var PyDefUtils = require("PyDefUtils");
import { defer } from "../utils";

/*#
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

module.exports = (pyModule) => {


    const {isTrue} = Sk.misceval;
    let YTLoadExecuted = false;
    const loadYT = async () => {
        try {
            YTLoadExecuted = true;
            await PyDefUtils.loadScript("https://www.youtube.com/iframe_api");
        } catch (e) {
            YTLoadExecuted = false;
            console.error(e);
        }
    };


    pyModule["YouTubeVideo"] = PyDefUtils.mkComponentCls(pyModule, "YouTubeVideo", {
        properties: PyDefUtils.assembleGroupProperties(/*!componentProps(YouTubeVideo)!1*/ ["layout", "layout_margin", "height", /*"interaction",*/ "appearance", "user data"], {
            height: { defaultValue: new Sk.builtin.int_(300) },

            youtube_id: /*!componentProp(YouTubeVideo)!1*/ {
                name: "youtube_id",
                type: "string",
                defaultValue: Sk.builtin.str.$empty,
                pyVal: true,
                dataBindingProp: "youtube_id",
                exampleValue: "m7kzwpJfEeY",
                description: "The ID of the YouTube video to play",
                suggested: true,
                set(s) {
                    update(s);
                },
            },

            autoplay: /*!componentProp(YouTubeVideo)!1*/ {
                name: "autoplay",
                type: "boolean",
                defaultValue: Sk.builtin.bool.false$,
                pyVal: true,
                description: "Set to true to play this video immediately",
                set(s) {
                    update(s);
                },
            },

            loop: /*!componentProp(YouTubeVideo)!1*/ {
                name: "loop",
                type: "boolean",
                defaultValue: Sk.builtin.bool.false$,
                pyVal: true,
                description: "Set to true to play this video repeatedly",
                set(s) {
                    update(s);
                },
            },

            current_time: /*!componentProp(YouTubeVideo)!1*/ {
                name: "current_time",
                type: "object",
                description: "Get or set the current playback position, in seconds.",
                exampleValue: 10.2,
                defaultValue: new Sk.builtin.float_(0.0),
                pyVal: true,
                set(s, e, v) {
                    v = Sk.ffi.remapToJs(v);
                    if (s._anvil.player && s._anvil.player.seekTo) {
                        s._anvil.player.seekTo(v, true);
                    }
                },
                get(s, e) {
                    if (s._anvil.player && s._anvil.player.getCurrentTime) {
                        return Sk.ffi.remapToPy(s._anvil.player.getCurrentTime());
                    }
                    return new Sk.builtin.float_(0);
                },
            },

            volume: /*!componentProp(YouTubeVideo)!1*/ {
                name: "volume",
                type: "object",
                description: "Get or set the current volume, from 0 - 100.",
                exampleValue: 50,
                defaultValue: new Sk.builtin.int_(50),
                pyVal: true,
                set(s, e, v) {
                    v = Sk.ffi.remapToJs(v);
                    if (s._anvil.player && s._anvil.player.setVolume && v != null) {
                        s._anvil.player.setVolume(v);
                    }
                },
                get(s, e) {
                    if (s._anvil.player && s._anvil.player.getVolume) {
                        return Sk.ffi.remapToPy(s._anvil.player.getVolume());
                    } else {
                        return new Sk.builtin.int_(0);
                    }
                },
            },

            state: /*!componentProp(YouTubeVideo)!1*/ {
                name: "state",
                type: "object",
                description: "Get the current playback state of the video as a string. E.g. PLAYING",
                readOnly: true,
                pyVal: true,
                get(s, e) {
                    if (s._anvil.player && s._anvil.player.getPlayerState) {
                        var state = s._anvil.player.getPlayerState();
                    }

                    return new Sk.builtin.str(translateState(state));
                },
            },

            duration: /*!componentProp(YouTubeVideo)!1*/ {
                name: "duration",
                type: "object",
                description: "Get the duration of the video in seconds.",
                readOnly: true,
                pyVal: true,
                get(s, e) {
                    if (s._anvil.player && s._anvil.player.getDuration) {
                        return Sk.ffi.remapToPy(s._anvil.player.getDuration());
                    } else {
                        return new Sk.builtin.int_(0);
                    }
                },
            },

            mute: /*!componentProp(YouTubeVideo)!1*/ {
                name: "mute",
                type: "boolean",
                description: "Set whether the video is muted or not.",
                defaultValue: Sk.builtin.bool.false$,
                pyVal: true,
                set(s, e, v) {
                    v = isTrue(v);
                    if (s._anvil.player && s._anvil.player.mute && s._anvil.player.unMute) {
                        if (v) {
                            s._anvil.player.mute();
                        } else {
                            s._anvil.player.unMute();
                        }
                    }
                },
            },
        }),

        events: PyDefUtils.assembleGroupEvents(/*!componentEvents()!3*/ "YouTubeVideo", ["universal", "user data"], {
            show: { description: "When this video is shown on the screen (or it is added to a visible form)" },
            hide: { description: "When this video is hidden from the screen (or it is removed from a visible form)" },
            state_change: /*!componentEvent(YouTubeVideo)!1*/ {
                name: "state_change",
                description: "When the video changes state (eg PAUSED to PLAYING)",
                parameters: [
                    {
                        name: "state",
                        type: "string",
                        description: "The new state of the video (values from the YouTube API)",
                        important: true,
                    },
                ],
                important: true,
                defaultEvent: true,
            },
        }),

        element: (props) => (
            <PyDefUtils.OuterElement style="min-height: 34px" className="anvil-youtube-video" {...props}>
                <iframe refName="iframe" enablejsapi={true} frameborder="0" allowfullscreen="" allow="autoplay" style="height: 100%; width: 100%;"></iframe>
            </PyDefUtils.OuterElement>
        ),

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew(pyModule["ClassicComponent"], (self) => {
                self._anvil.playerDefer = defer();
                self._anvil.player = null;
                update(self);

                if (!ANVIL_IN_DESIGNER) {
                    setTimeout(function load() {
                        if (window.YT && window.YT.Player) {
                            self._anvil.player = new window.YT.Player(self._anvil.elements.iframe, {
                                events: {
                                    onReady() {
                                        if (isTrue(self._anvil.getProp(["mute"]))) {
                                            self._anvil.player.mute();
                                        }
                                        self._anvil.playerDefer.resolve(self._anvil.player);
                                    },
                                    onStateChange(e) {
                                        PyDefUtils.raiseEventAsync({ state: translateState(e.data) }, self, "state_change");
                                    },
                                },
                            });
                        } else {
                            if (!YTLoadExecuted) {
                                loadYT();
                            }
                            console.log("YouTube Player not yet loaded. Trying again in 1 sec.");
                            setTimeout(load, 1000);
                        }
                    }, 0);
                }
            });

            /*!defMethod(_)!2*/ "Start playing this YouTube video"
            $loc["play"] = new Sk.builtin.func(function play(self) {
                self._anvil.playerDefer.promise.then((p) => p.playVideo());
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_)!2*/ "Pause this YouTube video"
            $loc["pause"] = new Sk.builtin.func(function pause(self) {
                self._anvil.playerDefer.promise.then((p) => p.pauseVideo());
                return Sk.builtin.none.none$;
            });

            /*!defMethod(_)!2*/ "Stop playing this YouTube video"
            $loc["stop"] = new Sk.builtin.func(function stop(self) {
                self._anvil.playerDefer.promise.then((p) => p.stopVideo());
                return Sk.builtin.none.none$;
            });
        },

    });


    function update(self) {
        function YouTubeGetID(url) {
            let ID = "";
            url = url.replace(/(>|<)/gi, "").split(/(vi\/|v=|\/v\/|youtu\.be\/|\/embed\/)/);
            if (url[2] !== undefined) {
                ID = url[2].split(/[^0-9a-z_-]/i);
                ID = ID[0];
            } else {
                ID = url;
            }
            return ID;
        }

        const VideoID = encodeURIComponent(YouTubeGetID(self._anvil.getProp("youtube_id").toString()));

        let src = "https://www.youtube.com/embed/" + VideoID + "?rel=0&enablejsapi=1";
        if (isTrue(self._anvil.getProp("autoplay"))) {
            src += "&autoplay=1";
        }
        if (isTrue(self._anvil.getProp("mute"))) {
            // set this now since autoplay is unlikely to work if we don't set mute to be true
            src += "&mute=1";
        }
        if (isTrue(self._anvil.getProp("loop"))) {
            src += "&loop=1";
            // If we want to loop, we must also set the 'playlist' parameter to the ID of the video. See https://developers.google.com/youtube/player_parameters?hl=en
            src += "&playlist=" + VideoID;
        }
        self._anvil.elements.iframe.setAttribute("src", src);
    }


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
        }
    };

};

/*!defClass(anvil,YouTubeVideo,Component)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, interaction, height, appearance
 *  - New props: youtube_id, autoplay, loop
 *
 */
