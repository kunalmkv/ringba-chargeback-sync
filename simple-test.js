// Simple test file to verify the eLocal scraper setup
import { createConfig } from './src/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test configuration validation
const testConfig = () => {
  console.log('Testing configuration validation...');
  
  try {
    const config = createConfig();
    
    // Check if required fields are present
    const requiredFields = ['elocalUsername', 'elocalPassword', 'dbPath'];
    const missingFields = requiredFields.filter(field => !config[field]);
    
    if (missingFields.length > 0) {
      console.error('❌ Configuration validation failed:', `Missing fields: ${missingFields.join(', ')}`);
      return false;
    }
    
    console.log('✅ Configuration validation passed');
    console.log('📧 Username:', config.elocalUsername);
    console.log('🗄️ Database path:', config.dbPath);
    console.log('🌐 Base URL:', config.elocalBaseUrl);
    return true;
  } catch (error) {
    console.error('❌ Configuration test failed:', error.message);
    return false;
  }
};

// Test database file exists
const testDatabase = () => {
  console.log('Testing database setup...');
  
  try {
    const fs = require('fs');
    const dbPath = './data/elocal_scraper.db';
    
    if (!fs.existsSync(dbPath)) {
      console.error('❌ Database file not found:', dbPath);
      return false;
    }
    
    const stats = fs.statSync(dbPath);
    console.log('✅ Database file exists');
    console.log('📊 Database size:', (stats.size / 1024).toFixed(2), 'KB');
    return true;
  } catch (error) {
    console.error('❌ Database test failed:', error.message);
    return false;
  }
};

// Test environment file
const testEnvironment = () => {
  console.log('Testing environment configuration...');
  
  try {
    const fs = require('fs');
    
    if (!fs.existsSync('.env')) {
      console.error('❌ .env file not found');
      return false;
    }
    
    const envContent = fs.readFileSync('.env', 'utf8');
    
    if (!envContent.includes('priyanshu@clickdee.com')) {
      console.error('❌ Username not found in .env file');
      return false;
    }
    
    if (!envContent.includes('Nothing@695')) {
      console.error('❌ Password not found in .env file');
      return false;
    }
    
    console.log('✅ Environment file configured correctly');
    return true;
  } catch (error) {
    console.error('❌ Environment test failed:', error.message);
    return false;
  }
};

// Test dependencies
const testDependencies = () => {
  console.log('Testing dependencies...');
  
  try {
    const packageJson = require('./package.json');
    const dependencies = Object.keys(packageJson.dependencies);
    
    console.log('📦 Installed dependencies:', dependencies.length);
    console.log('🔧 Key dependencies:', dependencies.slice(0, 5).join(', '));
    
    // Check if node_modules exists
    const fs = require('fs');
    if (!fs.existsSync('node_modules')) {
      console.error('❌ node_modules directory not found');
      return false;
    }
    
    console.log('✅ Dependencies installed');
    return true;
  } catch (error) {
    console.error('❌ Dependencies test failed:', error.message);
    return false;
  }
};

// Run all tests
const runTests = async () => {
  console.log('🧪 Running eLocal Scraper Tests...\n');
  
  const tests = [
    { name: 'Dependencies', fn: testDependencies },
    { name: 'Environment Configuration', fn: testEnvironment },
    { name: 'Database Setup', fn: testDatabase },
    { name: 'Configuration Validation', fn: testConfig }
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      const result = test.fn();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      console.error(`❌ ${test.name} test failed with error:`, error.message);
      failed++;
    }
    console.log(''); // Add spacing between tests
  }
  
  console.log('📊 Test Results:');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed! The scraper is ready to use.');
    console.log('\n🚀 Next steps:');
    console.log('1. Run scraper once: npm run scrape');
    console.log('2. Start scheduler: npm run schedule');
  } else {
    console.log('\n⚠️  Some tests failed. Please check the configuration.');
  }
};

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}

export { runTests };
