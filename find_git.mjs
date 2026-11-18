import pkg from 'dugite';
const { GitProcess } = pkg;

console.log('Git path:', GitProcess.gitDir);

try {
  const result = await GitProcess.exec(['--version'], process.cwd());
  console.log('Git version:', result.stdout.trim());
  console.log('Exit code:', result.exitCode);
} catch(e) {
  console.error('Error:', e.message);
}
