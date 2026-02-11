const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Read .env file
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.error('.env file not found');
  process.exit(1);
}

// Parse .env file and set environment variables
const envContent = fs.readFileSync(envPath, 'utf-8');
envContent.split('\n').forEach(line => {
  const trimmedLine = line.trim();
  if (trimmedLine && !trimmedLine.startsWith('#')) {
    const [key, ...valueParts] = trimmedLine.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=');
      process.env[key] = value;
    }
  }
});

// Set CSC_LINK to point to the certificate file
const certPath = path.join(__dirname, '.cert', 'signingCert.pfx');
if (!fs.existsSync(certPath)) {
  console.error('Certificate file not found at .cert/signingCert.pfx');
  process.exit(1);
}
process.env.CSC_LINK = certPath;

// Run the dist command
console.log('Building with code signing...');
try {
  execSync('npm run build && electron-builder', { stdio: 'inherit' });
  console.log('Build complete!');
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}
