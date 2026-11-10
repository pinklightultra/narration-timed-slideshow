# Slideshow Studio

[Back to the README](../README.md).

[`slideshow_studio.html`](../slideshow_studio.html) is a local preview of the same decision the CLI makes: where the pauses fell, and which picture is up while you listen. It is a second implementation of the detector. The mp4 is still produced by [`narration-sync.js`](../narration-sync.js).

```bash
node server.js
```

[`server.js`](../server.js) binds to `127.0.0.1` only and prints `Slideshow Studio server running at http://127.0.0.1:8429`. `--port` changes the port (default 8429). `npm run studio` is the same process. On Windows, [`launch_studio.bat`](../launch_studio.bat) opens that URL and then starts the server. Reload the page if the browser arrives first.

In the page:

1. Choose **Load Narration**, or drop an audio file on the window. The waveform is drawn from the decoded buffer. The drop target accepts `.wav`, `.mp3`, `.m4a`, `.flac`, and `.ogg`, and any file the browser reports as `audio/*`.
2. Choose **Load Slides**, or drop images. Names sort with numeric comparison, the same rule as the CLI. The page keeps `.png`, `.jpg`, `.jpeg`, `.webp`, and any other type the browser reports as `image/*`.
3. Move **Noise Floor** (-50 to -15 dB), **Min Silence** (0.20 to 1.50 s), and **Lead-in** (0.05 to 0.40 s). Each change re-detects. Those ranges are the sliders. The CLI accepts any non-negative duration and any numeric dB value, including values the sliders cannot express. **Re-Detect** runs the same pass again. **Auto-Align** remaps pictures onto the current segments. It does not detect silence again.
4. Press **Play**. Space toggles playback. **J** steps to the next segment, **K** to the previous one. The viewport shows the screenshot mapped to the segment under the playhead.
5. **+ Merge** on a segment card folds that card into the next one, in the preview.

Play is the browser playing your audio against the browser's segment list. It is not a playback of the mp4.

**Copy Command**, **Copy --groups**, and **Save Cues** sit under the timeline. Use them as notes. Take the timing you will publish from `--dry-run`. With nothing loaded, the command box shows `--output "video.mp4"`. After a narration is loaded, the generated command uses that file's name and `--output "screencast.mp4"`. It also uses the literal directory `./shots`, not the folder you dropped. The copied command is a note about the preview. The sections below are the parts the CLI will not reproduce.

## The detectors are different code

The CLI calls ffmpeg `silencedetect` with the noise and duration arguments in [How a hold is timed](timing.md), and without `mono=1`, so the filter's default channel mode is what runs. `detectSpeechSegmentsFromBuffer()` measures RMS on channel 0 only, in 40 ms windows, and compares it with `10^(dB/20)`. It then pads each segment by the lead-in on both sides, and it drops a segment whose padded duration is 0.25 s or shorter. The CLI drops a raw speech gap of 0.15 s or shorter, and it applies the lead-in at the end of a hold only. Browser segments can overlap. CLI holds do not.

A 0.10 s gap that does not sit against the start of the file fails the CLI test and is dropped. The same gap in the page, with the default 0.15 s lead-in on both edges, has a padded duration of 0.40 s and is kept. The segment count in the page header is the browser count. The count in `--dry-run` is the count the mp4 uses.

## Merge does not become `--groups`

`groupsConfig` is filled with a list of ones, and only when the screenshot count equals the segment count. `groupWithNext()` shortens the segment list and calls that function again. After the merge the counts differ, so the list of ones is left as it was. **Copy Command** appends `--groups` only when some stored count is greater than 1. A merge never meets that test, so the command you copy has no `--groups` at all. **Copy --groups** copies the stale list. Its sum is the segment count from before the merge, and the CLI rejects that sum. After a merge, write `--groups` from the CLI's own segment list.

When you do not merge, and you have more segments than screenshots, the page and the CLI do the same thing with the extras: they hold them on the last screenshot. The cuts can still disagree, because the detectors disagree.

## Save Cues is not an input

**Save Cues** downloads `narration-cues.json`, and nothing in this repository reads it. `narration-sync.js` has no cue-file argument. The JSON is a record of the browser's segments.

## The page never calls the server to render

`POST /api/render` on [`server.js`](../server.js) spawns the CLI with filesystem paths from the JSON body (`audio`, `screenshots`, and optional `output`, `groups`, `noise`, `min_silence`, `lead_in`). The request stays open until the CLI exits. Choosing a file in the browser does not give the server a path, and `slideshow_studio.html` does not send that request. The route is a local trigger for paths already on disk. It does not accept `--width` or `--height`.

Exit 0 answers with `ok: true`. Exit 2, the CLI's "the file was written and the narration was trimmed" status, answers with an error that says the mp4 was written. Any other non-zero exit answers with `Render failed with exit code …`. `GET /api/status` returns JSON with `ok: true`, the app name, and the port.

`.webp` and other non-JPEG/PNG images preview in the page and are ignored by the CLI. A folder that looks populated in the studio can dry-run as an empty directory.
