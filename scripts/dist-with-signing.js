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

// Run the dist command
console.log('Building with code signing...');
try {
  execSync('npm run build && electron-builder', { stdio: 'inherit' });
  console.log('Build complete!');
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}
