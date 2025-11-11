// Test file to verify the eLocal scraper setup
import { createConfig, validateConfig } from './src/index.js';
import { createLogger } from './src/utils/error-handling.js';

// Test configuration validation
const testConfig = () => {
  console.log('Testing configuration validation...');
  
  const config = createConfig();
  const result = validateConfig(config);
  
  if (result._tag === 'Left') {
    console.error('❌ Configuration validation failed:', result.left.message);
    return false;
  } else {
    console.log('✅ Configuration validation passed');
    return true;
  }
};

// Test logger creation
const testLogger = () => {
  console.log('Testing logger creation...');
  
  try {
    const config = createConfig();
    const logger = createLogger(config);
    
    logger.info('Test info message');
    logger.warn('Test warning message');
    logger.error('Test error message');
    
    console.log('✅ Logger creation and usage successful');
    return true;
  } catch (error) {
    console.error('❌ Logger test failed:', error.message);
    return false;
  }
};

// Test data processing utilities
const testDataProcessing = () => {
  console.log('Testing data processing utilities...');
  
  try {
    const { processCampaignCalls, processAdjustmentDetails } = require('./src/utils/helpers.js');
    
    // Test campaign calls processing
    const sampleCalls = [
      {
        dateOfCall: '10/27/25 01:01 AM EDT',
        campaignPhone: '(877) 834-1273',
        callerId: '(469) 256-1440',
        category: 'Appliance Repair',
        city: 'Beverly',
        state: 'NJ',
        zipCode: '08010',
        screenDuration: 18,
        postScreenDuration: 42,
        totalDuration: 60,
        callScreen: 'IVR',
        assessment: 'Transferred - Partner',
        classification: 'Transferred - Partner (insufficient call duration)',
        payout: '$0.00'
      }
    ];
    
    const processedCalls = processCampaignCalls(sampleCalls);
    console.log('Processed calls:', processedCalls.length);
    
    // Test adjustment details processing
    const sampleAdjustments = [
      {
        timeOfCall: '10/24/25 3:16 PM EDT',
        adjustmentTime: '10/27/25 9:23 AM EDT',
        campaignPhone: '(877) 834-1273',
        callerId: '(704) 616-0774',
        duration: 140,
        callSid: 'CON-14206b4d-cf4a-481b-a1c8-caf50a53b081',
        amount: '-$45.50',
        classification: 'Wrong Number : Looking specific provider : Manufacturer'
      }
    ];
    
    const processedAdjustments = processAdjustmentDetails(sampleAdjustments);
    console.log('Processed adjustments:', processedAdjustments.length);
    
    console.log('✅ Data processing utilities test successful');
    return true;
  } catch (error) {
    console.error('❌ Data processing test failed:', error.message);
    return false;
  }
};

// Test schema validation
const testSchemaValidation = () => {
  console.log('Testing schema validation...');
  
  try {
    const { CampaignCallSchema, AdjustmentDetailSchema } = require('./src/types/schemas.js');
    
    // Test valid campaign call
    const validCall = {
      dateOfCall: '2025-10-27T01:01:00Z',
      campaignPhone: '(877) 834-1273',
      callerId: '(469) 256-1440',
      category: 'Appliance Repair',
      city: 'Beverly',
      state: 'NJ',
      zipCode: '08010',
      screenDuration: 18,
      postScreenDuration: 42,
      totalDuration: 60,
      callScreen: 'IVR',
      assessment: 'Transferred - Partner',
      classification: 'Transferred - Partner (insufficient call duration)',
      payout: 0.00
    };
    
    const callResult = CampaignCallSchema.decode(validCall);
    if (callResult._tag === 'Left') {
      console.error('❌ Campaign call validation failed:', callResult.left);
      return false;
    }
    
    // Test valid adjustment detail
    const validAdjustment = {
      timeOfCall: '2025-10-24T15:16:00Z',
      adjustmentTime: '2025-10-27T09:23:00Z',
      campaignPhone: '(877) 834-1273',
      callerId: '(704) 616-0774',
      duration: 140,
      callSid: 'CON-14206b4d-cf4a-481b-a1c8-caf50a53b081',
      amount: -45.50,
      classification: 'Wrong Number : Looking specific provider : Manufacturer'
    };
    
    const adjustmentResult = AdjustmentDetailSchema.decode(validAdjustment);
    if (adjustmentResult._tag === 'Left') {
      console.error('❌ Adjustment detail validation failed:', adjustmentResult.left);
      return false;
    }
    
    console.log('✅ Schema validation test successful');
    return true;
  } catch (error) {
    console.error('❌ Schema validation test failed:', error.message);
    return false;
  }
};

// Run all tests
const runTests = async () => {
  console.log('🧪 Running eLocal Scraper Tests...\n');
  
  const tests = [
    { name: 'Configuration Validation', fn: testConfig },
    { name: 'Logger Creation', fn: testLogger },
    { name: 'Data Processing', fn: testDataProcessing },
    { name: 'Schema Validation', fn: testSchemaValidation }
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      const result = await test.fn();
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
  } else {
    console.log('\n⚠️  Some tests failed. Please check the configuration and dependencies.');
  }
};

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}

export { runTests };
