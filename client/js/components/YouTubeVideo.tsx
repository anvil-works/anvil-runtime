import { PyModMap } from "@runtime/runner/py-util";
import { isTrue, pyBool, pyFloat, pyFunc, pyInt, pyNone, pyStr, toJs, toPy } from "@Sk";
import PyDefUtils from "PyDefUtils";
import { defer } from "../utils";
import { ClassicComponent, ClassicComponentConstructor } from "./ClassicComponent";

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

interface YouTubeVideoAnvil {
    elements: { root: HTMLDivElement; iframe: HTMLIFrameElement };
    player: YT.Player | null;
    playerDefer: { promise: Promise<YT.Player>; resolve: (value: YT.Player) => void };
    getProp: (prop: string | string[]) => any;
}

interface YouTubeVideo extends ClassicComponent<YouTubeVideoAnvil> {}

const YouTubeVideoFactory = (pyModule: PyModMap) => {
    const ClassicComponent = pyModule["ClassicComponent"] as ClassicComponentConstructor;
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

    pyModule["YouTubeVideo"] = PyDefUtils.mkComponentCls<YouTubeVideo>(pyModule, "YouTubeVideo", {
        base: ClassicComponent,
        properties: PyDefUtils.assembleGroupProperties<YouTubeVideo>(
            /*!componentProps(YouTubeVideo)!1*/ [
                "layout",
                "layout_margin",
                "height",
                /*"interaction",*/ "appearance",
                "user data",
            ],
            {
                height: { defaultValue: new pyInt(300) },

                youtube_id: /*!componentProp(YouTubeVideo)!1*/ {
                    name: "youtube_id",
                    type: "string",
                    defaultValue: pyStr.$empty,
                    pyVal: true,
                    dataBindingProp: true,
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
                    defaultValue: pyBool.false$,
                    pyVal: true,
                    description: "Set to true to play this video immediately",
                    set(s) {
                        update(s);
                    },
                },

                loop: /*!componentProp(YouTubeVideo)!1*/ {
                    name: "loop",
                    type: "boolean",
                    defaultValue: pyBool.false$,
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
                    defaultValue: new pyFloat(0.0),
                    pyVal: true,
                    set(s, e, pyV) {
                        const v = toJs(pyV) as number;
                        if (s._anvil.player && s._anvil.player.seekTo) {
                            s._anvil.player.seekTo(v, true);
                        }
                    },
                    get(s, e) {
                        if (s._anvil.player && s._anvil.player.getCurrentTime) {
                            return toPy(s._anvil.player.getCurrentTime());
                        }
                        return new pyFloat(0);
                    },
                },

                volume: /*!componentProp(YouTubeVideo)!1*/ {
                    name: "volume",
                    type: "object",
                    description: "Get or set the current volume, from 0 - 100.",
                    exampleValue: 50,
                    defaultValue: new pyInt(50),
                    pyVal: true,
                    set(s, e, pyV) {
                        const v = toJs(pyV) as number;
                        if (s._anvil.player && s._anvil.player.setVolume && v != null) {
                            s._anvil.player.setVolume(v);
                        }
                    },
                    get(s, e) {
                        if (s._anvil.player && s._anvil.player.getVolume) {
                            return toPy(s._anvil.player.getVolume());
                        } else {
                            return toPy(0);
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
                        let state: number | undefined;
                        if (s._anvil.player && s._anvil.player.getPlayerState) {
                            state = s._anvil.player.getPlayerState();
                        }

                        return new pyStr(translateState(state));
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
                            return toPy(s._anvil.player.getDuration());
                        } else {
                            return toPy(0);
                        }
                    },
                },

                mute: /*!componentProp(YouTubeVideo)!1*/ {
                    name: "mute",
                    type: "boolean",
                    description: "Set whether the video is muted or not.",
                    defaultValue: pyBool.false$,
                    pyVal: true,
                    set(s, e, pyV) {
                        const v = isTrue(pyV);
                        if (s._anvil.player && s._anvil.player.mute && s._anvil.player.unMute) {
                            if (v) {
                                s._anvil.player.mute();
                            } else {
                                s._anvil.player.unMute();
                            }
                        }
                    },
                },
            }
        ),

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
                <iframe
                    refName="iframe"
                    enablejsapi
                    frameborder="0"
                    // @ts-expect-error - allowfullscreen with setAttribute is valid
                    allowfullscreen=""
                    allow="autoplay"
                    style="height: 100%; width: 100%;"></iframe>
            </PyDefUtils.OuterElement>
        ),

        locals($loc) {
            $loc["__new__"] = PyDefUtils.mkNew<YouTubeVideo>(ClassicComponent, (self) => {
                self._anvil.playerDefer = defer();
                self._anvil.player = null;
                update(self);

                if (!ANVIL_IN_DESIGNER) {
                    setTimeout(function load() {
                        if (window.YT && window.YT.Player) {
                            const player = new window.YT!.Player(self._anvil.elements.iframe, {
                                events: {
                                    onReady(event: YT.PlayerEvent) {
                                        if (isTrue(self._anvil.getProp(["mute"]))) {
                                            player.mute();
                                        }
                                        self._anvil.playerDefer.resolve(player);
                                    },
                                    onStateChange(event: YT.OnStateChangeEvent) {
                                        PyDefUtils.raiseEventAsync(
                                            { state: translateState(event.data) },
                                            self,
                                            "state_change"
                                        );
                                    },
                                },
                            });
                            self._anvil.player = player;
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

            /*!defMethod(_)!2*/ ("Start playing this YouTube video");
            $loc["play"] = new pyFunc(function play(self: YouTubeVideo) {
                self._anvil.playerDefer.promise.then((p) => p.playVideo());
                return pyNone;
            });

            /*!defMethod(_)!2*/ ("Pause this YouTube video");
            $loc["pause"] = new pyFunc(function pause(self: YouTubeVideo) {
                self._anvil.playerDefer.promise.then((p) => p.pauseVideo());
                return pyNone;
            });

            /*!defMethod(_)!2*/ ("Stop playing this YouTube video");
            $loc["stop"] = new pyFunc(function stop(self: YouTubeVideo) {
                self._anvil.playerDefer.promise.then((p) => p.stopVideo());
                return pyNone;
            });
        },
    });

    function update(self: YouTubeVideo) {
        function YouTubeGetID(url: string): string {
            let ID = "";
            const urlParts = url.replace(/(>|<)/gi, "").split(/(vi\/|v=|\/v\/|youtu\.be\/|\/embed\/)/);
            if (urlParts[2] !== undefined) {
                const idParts = urlParts[2].split(/[^0-9a-z_-]/i);
                ID = idParts[0];
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

    const translateState = (state: number | undefined): string => {
        switch (state) {
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

export default YouTubeVideoFactory;

/*!defClass(anvil,YouTubeVideo,Component)!*/

/*
 * TO TEST:
 *
 *  - Prop groups: layout, interaction, height, appearance
 *  - New props: youtube_id, autoplay, loop
 *
 */
