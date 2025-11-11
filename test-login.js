// Simple login test to debug the eLocal login process
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';

dotenv.config();

const testLogin = async () => {
  console.log('🔍 Testing eLocal login process...');
  
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    
    console.log('🌐 Navigating to eLocal login page...');
    await page.goto('https://www.elocal.com/partner_users/login', { waitUntil: 'networkidle2' });
    
    console.log('📸 Taking screenshot of login page...');
    await page.screenshot({ path: 'login-page.png' });
    
    console.log('🔍 Looking for login form elements...');
    
    // Wait a bit for the page to load
    await page.waitForTimeout(3000);
    
    // Check what elements are available
    const loginElements = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const buttons = Array.from(document.querySelectorAll('button'));
      const forms = Array.from(document.querySelectorAll('form'));
      
      return {
        inputs: inputs.map(input => ({
          type: input.type,
          name: input.name,
          id: input.id,
          placeholder: input.placeholder,
          className: input.className
        })),
        buttons: buttons.map(button => ({
          type: button.type,
          text: button.textContent?.trim(),
          className: button.className
        })),
        forms: forms.map(form => ({
          action: form.action,
          method: form.method,
          className: form.className
        }))
      };
    });
    
    console.log('📋 Found elements:', JSON.stringify(loginElements, null, 2));
    
    // Try to find username/email field
    const usernameSelectors = [
      'input[name="username"]',
      'input[name="email"]',
      'input[type="email"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="username" i]',
      '#username',
      '#email',
      '.username',
      '.email'
    ];
    
    let usernameField = null;
    for (const selector of usernameSelectors) {
      try {
        usernameField = await page.$(selector);
        if (usernameField) {
          console.log(`✅ Found username field with selector: ${selector}`);
          break;
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    if (!usernameField) {
      console.log('❌ Could not find username field');
      console.log('📸 Taking screenshot for debugging...');
      await page.screenshot({ path: 'login-debug.png' });
      return;
    }
    
    // Try to find password field
    const passwordSelectors = [
      'input[name="password"]',
      'input[type="password"]',
      '#password',
      '.password'
    ];
    
    let passwordField = null;
    for (const selector of passwordSelectors) {
      try {
        passwordField = await page.$(selector);
        if (passwordField) {
          console.log(`✅ Found password field with selector: ${selector}`);
          break;
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    if (!passwordField) {
      console.log('❌ Could not find password field');
      return;
    }
    
    // Fill in credentials
    console.log('📝 Filling in credentials...');
    await usernameField.type(process.env.ELOCAL_USERNAME);
    await passwordField.type(process.env.ELOCAL_PASSWORD);
    
    // Take screenshot before submitting
    await page.screenshot({ path: 'login-filled.png' });
    
    // Try to find submit button
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:contains("Login")',
      'button:contains("Sign In")',
      'button:contains("Log In")',
      '.login-button',
      '.submit-button'
    ];
    
    let submitButton = null;
    for (const selector of submitSelectors) {
      try {
        submitButton = await page.$(selector);
        if (submitButton) {
          console.log(`✅ Found submit button with selector: ${selector}`);
          break;
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    if (!submitButton) {
      console.log('❌ Could not find submit button');
      return;
    }
    
    console.log('🚀 Clicking submit button...');
    await submitButton.click();
    
    // Wait for navigation or error
    await page.waitForTimeout(5000);
    
    // Take screenshot after submit
    await page.screenshot({ path: 'login-submitted.png' });
    
    // Check if we're logged in
    const currentUrl = page.url();
    console.log(`📍 Current URL: ${currentUrl}`);
    
    if (currentUrl.includes('dashboard') || currentUrl.includes('partner') || !currentUrl.includes('login')) {
      console.log('✅ Login successful!');
    } else {
      console.log('❌ Login failed - still on login page');
      
      // Check for error messages
      const errorMessages = await page.evaluate(() => {
        const errorElements = Array.from(document.querySelectorAll('.error, .alert, .message, [class*="error"], [class*="alert"]'));
        return errorElements.map(el => el.textContent?.trim()).filter(text => text);
      });
      
      if (errorMessages.length > 0) {
        console.log('🚨 Error messages:', errorMessages);
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    console.log('⏳ Keeping browser open for 10 seconds for inspection...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    await browser.close();
  }
};

testLogin().catch(console.error);
