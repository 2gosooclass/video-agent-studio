// 나레이션 음성 제공자.
// 1순위: VoiceBox 제로샷 내 목소리 복제 (선택 시) 또는 Gemini TTS (설정에 API 키가 있을 때).
// 2순위: 운영체제 기본 음성 (맥 say, 윈도우 System.Speech).
const {execFile} = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

// VoiceBox 로컬/원격 서버 연동 (대표님 고유 목소리 또는 커스텀 복제 보이스)
async function synthesizeVoiceBox(text, outPath, ffmpegPath, opts) {
  const baseUrl = (opts.voiceboxUrl || 'http://192.168.12.86:17493').replace(/\/$/, '');
  const profileId = opts.voiceboxProfile || 'ddf94b87-c330-41cf-96be-820d5c279dcd';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${baseUrl}/api/tts`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({text, profile_id: profileId, language: 'ko'}),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`VoiceBox 응답 오류: ${res.status}`);
    const wavPath = outPath + '.vb.wav';
    fs.writeFileSync(wavPath, Buffer.from(await res.arrayBuffer()));
    await run(ffmpegPath, ['-y', '-loglevel', 'error', '-i', wavPath, outPath]);
    fs.unlinkSync(wavPath);
    return outPath;
  } finally {
    clearTimeout(timer);
  }
}

// Gemini TTS: 응답은 24kHz 16비트 PCM이라 ffmpeg로 변환해 저장한다.
async function synthesizeGemini(text, outPath, ffmpegPath, opts) {
  const model = opts.ttsModel || 'gemini-2.5-flash-preview-tts';
  const voice = (!opts.voice || opts.voice === 'VoiceBox') ? 'Kore' : opts.voice;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      contents: [{parts: [{text}]}],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {voiceConfig: {prebuiltVoiceConfig: {voiceName: voice}}},
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini TTS 오류 (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const part = ((json.candidates || [])[0] || {}).content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error('Gemini TTS 응답에 음성이 없습니다.');
  const pcmPath = outPath + '.pcm';
  fs.writeFileSync(pcmPath, Buffer.from(part.inlineData.data, 'base64'));
  await run(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcmPath, outPath]);
  fs.unlinkSync(pcmPath);
  return outPath;
}

async function synthesizeOS(text, outPath, ffmpegPath) {
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
  return null;
}

async function synthesize(text, outPath, ffmpegPath, opts = {}) {
  if (opts.voice === 'VoiceBox') {
    try {
      return await synthesizeVoiceBox(text, outPath, ffmpegPath, opts);
    } catch (e) {
      // VoiceBox 미연결 시 Gemini TTS 또는 OS 기본 음성으로 폴백
    }
  }
  if (opts.apiKey) {
    try {
      return await synthesizeGemini(text, outPath, ffmpegPath, opts);
    } catch (e) {
      try {
        return await synthesizeOS(text, outPath, ffmpegPath);
      } catch (e2) {
        return null;
      }
    }
  }
  return synthesizeOS(text, outPath, ffmpegPath);
}

module.exports = {synthesize};
