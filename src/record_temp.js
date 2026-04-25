const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const outputFile = process.argv[2] || path.join(__dirname, '..', 'temp', 'input.wav');

const tempDir = path.dirname(outputFile);
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

console.log('Starting recording to:', outputFile);

let sox = spawn('sox', [
  '-d',
  '-r', '16000',
  '-c', '1',
  '-b', '16',
  '-t', 'wav',
  outputFile
]);

sox.on('close', (code) => {
  console.log('Recording stopped, exit code:', code);
  process.exit(code);
});

sox.on('error', (err) => {
  console.error('SoX error:', err.message);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('Stopping recording...');
  sox.kill();
});

process.on('SIGTERM', () => {
  console.log('Stopping recording...');
  sox.kill();
});

setTimeout(() => {
  console.log('Max recording time reached');
  sox.kill();
}, 10000);