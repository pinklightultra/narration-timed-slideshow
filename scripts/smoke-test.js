#!/usr/bin/env node
/**
 * smoke-test.js -- prove the thing works, on synthesized input, before you trust it on yours.
 *
 * Two halves:
 *
 *   Pure checks run with no ffmpeg at all. They cover the two functions whose bugs are silent:
 *   filename ordering (a lexicographic sort puts shot-10 before shot-2 and reports success) and
 *   silence inversion.
 *
 *   The end-to-end check needs ffmpeg. It builds a 6-second tone-and-silence audio file and
 *   three solid-colour PNGs with ffmpeg itself, runs the real CLI, and measures the result. If
 *   ffmpeg is missing it SKIPS and says so, and the exit code reflects that a skip is not a pass.
 *
 * Run: node scripts/smoke-test.js
 */
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const lib = require('../narration-sync.js');

const CLI = path.join(__dirname, '..', 'narration-sync.js');
let pass = 0;
let fail = 0;
let skip = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    pass += 1;
  } catch (e) {
    console.error(`FAIL ${name}\n     ${e.message}`);
    fail += 1;
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ---------------------------------------------------------------- pure checks

check('naturalSort orders shot-2 before shot-10', () => {
  const got = lib.naturalSort(['shot-10.png', 'shot-2.png', 'shot-1.png']);
  assert(
    JSON.stringify(got) === JSON.stringify(['shot-1.png', 'shot-2.png', 'shot-10.png']),
    `got ${JSON.stringify(got)}`
  );
  // The bug this guards against, spelled out: a plain sort passes the zero-padded case and
  // fails the unpadded one, so a test using only padded names would report green.
  const lexicographic = ['shot-10.png', 'shot-2.png', 'shot-1.png'].slice().sort();
  assert(lexicographic[1] === 'shot-10.png', 'expected the plain sort to be wrong here');
});

check('naturalSort leaves zero-padded names alone', () => {
  const got = lib.naturalSort(['s-03.png', 's-01.png', 's-02.png']);
  assert(JSON.stringify(got) === JSON.stringify(['s-01.png', 's-02.png', 's-03.png']),
    `got ${JSON.stringify(got)}`);
});

check('silencesToSpeechSegments inverts gaps', () => {
  const segs = lib.silencesToSpeechSegments([{ start: 1, end: 2 }, { start: 3, end: 4 }], 5);
  assert(segs.length === 3, `expected 3 segments, got ${segs.length}`);
  assert(segs[0].start === 0 && segs[0].end === 1, 'first segment should be 0-1');
  assert(segs[2].start === 4 && segs[2].end === 5, 'last segment should run to the total duration');
});

check('silencesToSpeechSegments drops sub-threshold blips', () => {
  // A 0.1s gap is a breath or a click, not a step, and must not claim a screenshot.
  const segs = lib.silencesToSpeechSegments([{ start: 0.1, end: 1 }, { start: 2, end: 3 }], 4);
  assert(segs.every((s) => s.end - s.start > 0.15), 'a sub-threshold segment survived');
});

check('silence covering the whole file yields no segments', () => {
  assert(lib.silencesToSpeechSegments([{ start: 0, end: 5 }], 5).length === 0,
    'expected zero segments for wall-to-wall silence');
});

check('applyGroups merges consecutive segments', () => {
  const segs = [{ start: 0, end: 1 }, { start: 2, end: 3 }, { start: 4, end: 5 }];
  const merged = lib.applyGroups(segs, [2, 1]);
  assert(merged.length === 2, `expected 2 merged segments, got ${merged.length}`);
  assert(merged[0].start === 0 && merged[0].end === 3, 'group of 2 should span 0-3');
});

// ---------------------------------------------------------------- end to end

function haveFfmpeg() {
  return ['ffmpeg', 'ffprobe'].every((bin) => {
    const r = spawnSync(bin, ['-version'], { encoding: 'utf-8' });
    return !r.error && r.status === 0;
  });
}

if (!haveFfmpeg()) {
  console.log('SKIP end-to-end render: ffmpeg/ffprobe not on PATH.');
  console.log('     The pure checks above ran, but nothing here has proven that a video renders.');
  skip += 1;
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narration-sync-smoke-'));
  try {
    const shotsDir = path.join(tmp, 'shots');
    fs.mkdirSync(shotsDir);
    const audio = path.join(tmp, 'narration.wav');
    const out = path.join(tmp, 'out.mp4');

    // 6s of audio: a 440Hz tone for the first second of every 2s period, silence otherwise.
    // That is three "spoken" stretches separated by two pauses, plus a trailing pause.
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i',
      'aevalsrc=0.5*sin(440*2*PI*t)*between(mod(t\\,2)\\,0\\,1):d=6:s=44100',
      audio], { stdio: 'pipe' });

    // Deliberately unpadded names, so a lexicographic sort would order them 1, 10, 2.
    const colours = ['red', 'green', 'blue'];
    ['1', '2', '10'].forEach((n, i) => {
      execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=${colours[i]}:s=320x240`,
        '-frames:v', '1', path.join(shotsDir, `shot-${n}.png`)], { stdio: 'pipe' });
    });

    const run = spawnSync('node', [CLI, '--audio', audio, '--screenshots', shotsDir,
      '--output', out, '--width', '320', '--height', '240'], { encoding: 'utf-8' });

    check('CLI exits 0 on a clean run', () => {
      assert(run.status === 0,
        `exit ${run.status}\n--- stdout ---\n${run.stdout}\n--- stderr ---\n${run.stderr}`);
    });

    check('it detected 3 speech segments', () => {
      assert(/-> 3 speech segments/.test(run.stdout || ''),
        `segment line not found. stdout:\n${run.stdout}`);
    });

    check('screenshots were ordered 1, 2, 10', () => {
      const order = [...(run.stdout || '').matchAll(/\[\d\] (shot-\d+\.png)/g)].map((m) => m[1]);
      assert(JSON.stringify(order) === JSON.stringify(['shot-1.png', 'shot-2.png', 'shot-10.png']),
        `got ${JSON.stringify(order)}`);
    });

    check('an mp4 was written', () => {
      assert(fs.existsSync(out), 'no output file');
      assert(fs.statSync(out).size > 1024, `output is only ${fs.statSync(out).size} bytes`);
    });

    check('the full narration survived (no -shortest truncation)', () => {
      const dur = lib.duration(out);
      // The whole point of extending the final hold to the end of the audio. 6s in, 6s out.
      assert(Math.abs(dur - 6) < 0.4, `output is ${dur.toFixed(2)}s, expected about 6s`);
      assert(!/WARNING: the last/.test(run.stderr || ''),
        'the truncation warning fired on a run that should not truncate');
    });

    check('temp files were cleaned up', () => {
      for (const leftover of [`${out}.concat.txt`, `${out}.silent.mp4`]) {
        assert(!fs.existsSync(leftover), `left behind ${path.basename(leftover)}`);
      }
    });

    check('--dry-run writes nothing', () => {
      const dryOut = path.join(tmp, 'dry.mp4');
      const dry = spawnSync('node', [CLI, '--audio', audio, '--screenshots', shotsDir,
        '--output', dryOut, '--dry-run'], { encoding: 'utf-8' });
      assert(dry.status === 0, `exit ${dry.status}: ${dry.stderr}`);
      assert(!fs.existsSync(dryOut), '--dry-run produced an output file');
    });

    check('a --groups sum that does not match the segment count is rejected', () => {
      const bad = spawnSync('node', [CLI, '--audio', audio, '--screenshots', shotsDir,
        '--output', path.join(tmp, 'bad.mp4'), '--groups', '2,2'], { encoding: 'utf-8' });
      assert(bad.status === 1, `expected exit 1, got ${bad.status}`);
      assert(/--groups sums to 4 but 3 segments/.test(bad.stderr || ''),
        `unexpected stderr:\n${bad.stderr}`);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- verdict

console.log('');
console.log(`${pass} passed, ${fail} failed, ${skip} skipped.`);
if (skip) {
  console.log('A skip is not a pass. Install ffmpeg and run this again before trusting the tool.');
}
// Exit 2 for a skip so CI or a shell chain cannot read a partial run as a green one.
process.exit(fail ? 1 : (skip ? 2 : 0));
