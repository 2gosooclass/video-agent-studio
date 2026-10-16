// 엔진 단독 테스트: Electron 없이 Node로 파이프라인만 돌려 본다.
// 이 환경(리눅스)에서는 시스템 음성이 없어 추정 길이의 무음 나레이션으로 진행된다.
const path = require('path');
const fs = require('fs');
const {buildProject} = require('./engine');

async function main() {
  const assetsDir = path.join(__dirname, 'test-assets');
  const scenes = JSON.parse(fs.readFileSync(path.join(assetsDir, 'script.json'), 'utf8'))
    .map((s) => ({image: path.join(assetsDir, s.card), narration: s.narration}));
  const result = await buildProject(
    {
      scenes,
      keywords: ['10억 토큰', '구독 결제', '차액 환불', '24시간 자동 모니터링', 'Muse AI'],
      workDir: path.join(__dirname, 'test-work'),
      outputPath: path.join(__dirname, 'test-output.mp4'),
    },
    (stage, cur, total) => console.log(stage, cur, '/', total)
  );
  console.log('RESULT', result);
}

main().catch((e) => {
  console.error('FAILED', e.message);
  process.exit(1);
});
