import fs from 'fs';

console.log('--- ENVS ---');
for (const key of Object.keys(process.env)) {
  if (key.toLowerCase().includes('git') || key.toLowerCase().includes('repo') || key.toLowerCase().includes('app') || key.toLowerCase().includes('url')) {
    console.log(`${key}: ${process.env[key]}`);
  }
}
console.log('--- ALL KEYS (SANS SECRETS) ---');
console.log(Object.keys(process.env).filter(k => !k.toLowerCase().includes('key') && !k.toLowerCase().includes('secret') && !k.toLowerCase().includes('token')));
