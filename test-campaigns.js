// Test to see the campaigns page structure
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';

dotenv.config();

const testCampaignsPage = async () => {
  console.log('🔍 Testing campaigns page structure...');
  
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
    
    console.log('🌐 Navigating to login page...');
    await page.goto('https://www.elocal.com/partner_users/login', { waitUntil: 'networkidle2' });
    
    console.log('📝 Logging in...');
    await page.waitForSelector('input[name="partner_user[username]"]', { timeout: 10000 });
    
    const usernameField = await page.$('input[name="partner_user[username]"]');
    const passwordField = await page.$('input[name="partner_user[password]"]');
    const submitButton = await page.$('button[type="submit"]');
    
    await usernameField.type(process.env.ELOCAL_USERNAME);
    await passwordField.type(process.env.ELOCAL_PASSWORD);
    await submitButton.click();
    
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
    console.log(`✅ Logged in! Current URL: ${page.url()}`);
    
    console.log('📸 Taking screenshot of dashboard...');
    await page.screenshot({ path: 'dashboard.png' });
    
    console.log('🔍 Looking for campaigns...');
    
    // Wait a bit for the page to load
    await page.waitForTimeout(3000);
    
    // Look for campaign elements
    const campaignElements = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      const links = Array.from(document.querySelectorAll('a'));
      const campaignTexts = Array.from(document.querySelectorAll('*')).filter(el => 
        el.textContent && el.textContent.includes('Appliance Repair')
      );
      
      return {
        tables: tables.length,
        links: links.length,
        campaignTexts: campaignTexts.map(el => ({
          tagName: el.tagName,
          text: el.textContent?.trim().substring(0, 100),
          className: el.className,
          href: el.href
        }))
      };
    });
    
    console.log('📋 Found elements:', JSON.stringify(campaignElements, null, 2));
    
    // Look specifically for the Appliance Repair campaign
    const applianceRepairElement = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      return elements.find(el => 
        el.textContent && 
        el.textContent.includes('Appliance Repair') && 
        el.textContent.includes('Revshare')
      );
    });
    
    if (applianceRepairElement) {
      console.log('✅ Found Appliance Repair campaign element');
    } else {
      console.log('❌ Could not find Appliance Repair campaign');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    console.log('⏳ Keeping browser open for 10 seconds for inspection...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    await browser.close();
  }
};

testCampaignsPage().catch(console.error);

