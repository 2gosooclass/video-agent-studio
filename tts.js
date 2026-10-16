// 운영체제 기본 음성으로 나레이션을 만드는 제공자.
// 나중에 대표님 목소리 복제(제로샷) 제공자를 같은 자리(interface)에 끼울 수 있게 분리해 둠.
const {execFile} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

// 맥: say 명령이 파일로 바로 저장. 윈도우: PowerShell System.Speech로 WAV 저장. 리눅스: 미지원(무음 처리).
async function synthesize(text, outPath, ffmpegPath) {
  if (process.platform === 'darwin') {
    const aiff = outPath + '.aiff';
    await run('say', ['-v', 'Yuna', '-o', aiff, text]);
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', aiff, outPath]);
    fs.unlinkSync(aiff);
    return outPath;
  }
  if (process.platform === 'win32') {
    const wav = outPath + '.wav';
    const ps = [
      'Add-Type -AssemblyName System.Speech;',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
      '$ko = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like "ko-*" } | Select-Object -First 1;',
      'if ($ko) { $s.SelectVoice($ko.VoiceInfo.Name) };',
      `$s.SetOutputToWaveFile('${wav.replace(/'/g, "''")}');`,
      `$s.Speak('${text.replace(/'/g, "''")}');`,
      '$s.Dispose();',
    ].join(' ');
    await run('powershell', ['-NoProfile', '-Command', ps]);
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', wav, outPath]);
    fs.unlinkSync(wav);
    return outPath;
  }
  return null; // 지원 안 되는 환경이면 나레이션 없이 진행
}

module.exports = {synthesize};
