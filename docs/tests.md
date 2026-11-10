# Tests

[Back to the README](../README.md).

[`scripts/smoke-test.js`](../scripts/smoke-test.js) is the test. It has two halves, and the exit code refuses to treat the first half as the whole test.

Run it with `node scripts/smoke-test.js` or `npm run smoke`.

| Exit | Meaning |
|---|---|
| 0 | Every check passed, including a rendered mp4. |
| 1 | A check failed. |
| 2 | ffmpeg or ffprobe is missing. The checks that do not need ffmpeg still ran. A skip is not a pass, and the script says so. |

A clean run on a machine with ffmpeg ends with `14 passed, 0 failed, 0 skipped.`

## Checks that need no ffmpeg

The half that needs no ffmpeg calls the exported functions:

- `naturalSort` orders `shot-1.png`, `shot-2.png`, `shot-10.png`. The same check asserts that a plain `sort()` puts `shot-10.png` second.
- `naturalSort` orders `s-01.png`, `s-02.png`, `s-03.png`.
- `silencesToSpeechSegments` turns silences at 1–2 s and 3–4 s, in a 5 s span, into three segments. The last one runs to the duration.
- A 0.1 s gap does not survive as a segment.
- Silence that covers the whole file yields no segments.
- `applyGroups` with `[2, 1]` merges three segments into two. The first merged segment spans the start of the first input to the end of the second.

## Checks that need ffmpeg

The half that needs ffmpeg builds a 6 s tone: 440 Hz for the first second of every 2 s period, silence otherwise. That is three speech stretches and a trailing pause. It writes `shot-1.png`, `shot-2.png`, and `shot-10.png` as solid colors, unpadded on purpose, and runs the real CLI at 320×240. It then requires all of the following: exit 0, a log line reporting 3 speech segments, the printed order `shot-1.png`, `shot-2.png`, `shot-10.png`, an mp4 larger than 1 KB, an `ffprobe` duration within 0.4 s of 6, no truncation warning, deletion of the concat list and the silent video, a `--dry-run` that writes no file, and `--groups 2,2` exiting 1 with stderr that the groups sum to 4 against 3 detected segments.

The test does not decode a frame. A wrong pad, a cropped picture, or the right file held for the wrong interval can pass. The order check reads the screenshot names the CLI printed. It does not read frames out of the mp4.

## What CI runs

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every push and pull request to `main` or `master`, and on manual dispatch. The job installs ffmpeg on `ubuntu-latest` and runs `npm run smoke` on Node 18, 20, and 22.

The studio page, `POST /api/render`, and the bytes of a frame are not in that run.
