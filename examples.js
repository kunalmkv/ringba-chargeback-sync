// Example usage of the eLocal scraper service
import { scrapeElocalData, createConfig, initializeDatabase } from './src/index.js';
import { createLogger } from './src/utils/error-handling.js';
import * as TE from 'fp-ts/TaskEither';

// Example 1: Basic usage
const basicExample = async () => {
  console.log('🚀 Running basic scraper example...');
  
  const config = createConfig();
  const logger = createLogger(config);
  
  try {
    // Initialize database
    logger.info('Initializing database...');
    await TE.getOrElse(() => {
      throw new Error('Database initialization failed');
    })(initializeDatabase(config))();
    
    // Run scraper
    logger.info('Starting scraper...');
    const result = await TE.getOrElse(() => {
      throw new Error('Scraping failed');
    })(scrapeElocalData(config))();
    
    logger.info('Scraping completed successfully', result.summary);
    return result;
  } catch (error) {
    logger.error('Example failed', error.message);
    throw error;
  }
};

// Example 2: Custom configuration
const customConfigExample = async () => {
  console.log('🔧 Running custom configuration example...');
  
  const customConfig = {
    ...createConfig(),
    headlessBrowser: false, // Show browser window
    requestDelayMs: 2000,   // Slower requests
    maxRetries: 5,          // More retries
    timeoutMs: 60000,       // Longer timeout
    logLevel: 'debug'       // Verbose logging
  };
  
  const logger = createLogger(customConfig);
  
  try {
    const result = await TE.getOrElse(() => {
      throw new Error('Custom scraping failed');
    })(scrapeElocalData(customConfig))();
    
    logger.info('Custom scraping completed', result.summary);
    return result;
  } catch (error) {
    logger.error('Custom example failed', error.message);
    throw error;
  }
};

// Example 3: Error handling demonstration
const errorHandlingExample = async () => {
  console.log('⚠️  Running error handling example...');
  
  const config = createConfig();
  const logger = createLogger(config);
  
  // Simulate invalid configuration
  const invalidConfig = {
    ...config,
    elocalUsername: '', // Invalid username
    elocalPassword: ''  // Invalid password
  };
  
  try {
    const result = await TE.getOrElse(() => {
      logger.warn('Expected error occurred - this is a demonstration');
      return null;
    })(scrapeElocalData(invalidConfig))();
    
    if (result) {
      logger.info('Unexpected success', result.summary);
    } else {
      logger.info('Error handling demonstration completed');
    }
  } catch (error) {
    logger.error('Error handling example failed', error.message);
  }
};

// Example 4: Batch processing
const batchProcessingExample = async () => {
  console.log('📦 Running batch processing example...');
  
  const config = createConfig();
  const logger = createLogger(config);
  
  try {
    // Run multiple scraping sessions
    const sessions = [];
    for (let i = 0; i < 3; i++) {
      logger.info(`Starting batch session ${i + 1}/3`);
      
      const result = await TE.getOrElse(() => {
        throw new Error(`Batch session ${i + 1} failed`);
      })(scrapeElocalData(config))();
      
      sessions.push(result);
      logger.info(`Batch session ${i + 1} completed`, result.summary);
      
      // Wait between sessions
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Aggregate results
    const totalCalls = sessions.reduce((sum, session) => sum + session.summary.totalCalls, 0);
    const totalAdjustments = sessions.reduce((sum, session) => sum + session.summary.totalAdjustments, 0);
    
    logger.info('Batch processing completed', {
      sessions: sessions.length,
      totalCalls,
      totalAdjustments
    });
    
    return sessions;
  } catch (error) {
    logger.error('Batch processing failed', error.message);
    throw error;
  }
};

// Example 5: Data analysis
const dataAnalysisExample = async () => {
  console.log('📊 Running data analysis example...');
  
  const config = createConfig();
  const logger = createLogger(config);
  
  try {
    // Run scraper
    const result = await TE.getOrElse(() => {
      throw new Error('Data analysis scraping failed');
    })(scrapeElocalData(config))();
    
    // Analyze the data
    const calls = result.calls;
    const adjustments = result.adjustments;
    
    // Calculate statistics
    const stats = {
      totalCalls: calls.length,
      totalAdjustments: adjustments.length,
      averagePayout: calls.reduce((sum, call) => sum + call.payout, 0) / calls.length,
      averageAdjustment: adjustments.reduce((sum, adj) => sum + adj.amount, 0) / adjustments.length,
      uniqueCallers: new Set([...calls.map(c => c.callerId), ...adjustments.map(a => a.callerId)]).size,
      topCategories: calls.reduce((acc, call) => {
        acc[call.category] = (acc[call.category] || 0) + 1;
        return acc;
      }, {}),
      adjustmentTypes: adjustments.reduce((acc, adj) => {
        acc[adj.classification] = (acc[adj.classification] || 0) + 1;
        return acc;
      }, {})
    };
    
    logger.info('Data analysis completed', stats);
    return { result, stats };
  } catch (error) {
    logger.error('Data analysis failed', error.message);
    throw error;
  }
};

// Run examples
const runExamples = async () => {
  console.log('🎯 eLocal Scraper Examples\n');
  
  const examples = [
    { name: 'Basic Usage', fn: basicExample },
    { name: 'Custom Configuration', fn: customConfigExample },
    { name: 'Error Handling', fn: errorHandlingExample },
    { name: 'Batch Processing', fn: batchProcessingExample },
    { name: 'Data Analysis', fn: dataAnalysisExample }
  ];
  
  for (const example of examples) {
    try {
      console.log(`\n📋 Running ${example.name}...`);
      await example.fn();
      console.log(`✅ ${example.name} completed successfully`);
    } catch (error) {
      console.error(`❌ ${example.name} failed:`, error.message);
    }
  }
  
  console.log('\n🎉 All examples completed!');
};

// Export examples for programmatic use
export {
  basicExample,
  customConfigExample,
  errorHandlingExample,
  batchProcessingExample,
  dataAnalysisExample,
  runExamples
};

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExamples().catch(console.error);
}

