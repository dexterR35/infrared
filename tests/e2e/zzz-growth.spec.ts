import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {credentialsFile} from './environment.js';
async function login(page:Page){if(!process.env.E2E_DATA_DIR)throw new Error('DISPOSABLE_E2E_FIXTURE_REQUIRED');const session=JSON.parse(await readFile(path.join(path.dirname(credentialsFile),'browser-session.json'),'utf8'));await page.goto('/');await page.context().addCookies([{name:'ir_session',value:session.cookie,url:new URL(page.url()).origin,httpOnly:true,sameSite:'Strict'}]);await page.reload();await expect(page.getByRole('heading',{name:'Landing pages.'})).toBeVisible();}
test('market registry validates exact landing pages and scopes the portfolio',async({page})=>{
 await login(page);await page.goto('/#markets');await expect(page.getByRole('heading',{name:'Markets & registry.'})).toBeVisible();
 const before=await (await page.request.get('/api/bootstrap')).json();
 const rows=[{name:'UK Casino · Summer WO',page_key:'casino-summer-wo',url:'https://uk.landing.example.com/casino/?lp=summer-wo',market:'UK',product:'casino',brand:'example',locale:'en-GB',currency:'GBP',report_timezone:'Europe/London',page_family:'summer',acquisition_goal:'registration_completed'}];
 await page.getByLabel('Registry import JSON').fill(JSON.stringify(rows));await page.getByRole('button',{name:'Validate import',exact:true}).click();await expect(page.getByText('1 changes validated. Ready to apply.')).toBeVisible();
 expect((await (await page.request.get('/api/bootstrap')).json()).pages.length).toBe(before.pages.length);
 await page.getByRole('button',{name:'Apply validated changes',exact:true}).click();await expect(page.getByText('Registry updated. New real-site pages remain disabled.')).toBeVisible();
 await page.getByLabel('Portfolio market',{exact:true}).selectOption('UK');await page.getByLabel('Portfolio product',{exact:true}).selectOption('casino');
 const table=page.getByRole('table',{name:'Market landing pages',exact:true});await expect(table.locator('tbody tr[data-row-id]')).toHaveCount(1);await expect(table).toContainText('UK Casino');
 const data=await (await page.request.get('/api/bootstrap')).json();expect(data.pages.find((p:any)=>p.page_key==='casino-summer-wo').enabled).toBe(false);
 await page.screenshot({path:'.local/evidence/growth-market-registry.png',fullPage:true});await page.setViewportSize({width:375,height:812});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('registry drafts and read-only link checks never imply installation or manufacture traffic',async({page})=>{
 await login(page);await page.goto('/#markets');await page.getByLabel('Portfolio market',{exact:true}).selectOption('UK');
 const registry=page.getByRole('table',{name:'Market landing pages',exact:true});await expect(registry).toContainText('Draft · collection disabled');await expect(registry).toContainText('No recorded events received');await expect(page.getByText('Report date boundaries currently use UTC for every market',{exact:false})).toBeVisible();
 await page.goto('/#installation');await page.getByLabel('Landing page',{exact:true}).selectOption('local-demo/casino-halloween');
 const panel=page.getByRole('region',{name:'Landing page installation check',exact:true});
 const before=(await (await page.request.get('/api/installations')).json()).rows.find((r:any)=>r.site_id==='local-demo'&&r.page_key==='casino-halloween');
 const response=page.waitForResponse(r=>r.url().endsWith('/api/pages/local-demo/casino-halloween/check-installation')&&r.request().method()==='POST');
 await panel.getByRole('button',{name:'Check link & pixel',exact:true}).click();expect((await response).status()).toBe(200);
 await expect(panel).toContainText('Success · page loads · HTTP 200');await expect(panel).toContainText('Pixel code detected');await expect(panel).toContainText('Site key matches.');await expect(panel).toContainText('Response headers:');
 const after=(await (await page.request.get('/api/installations')).json()).rows.find((r:any)=>r.site_id==='local-demo'&&r.page_key==='casino-halloween');expect(after.last_event_at).toBe(before.last_event_at);
 await page.reload();await expect(panel).toContainText('Pixel code detected');await page.screenshot({path:'.local/evidence/installation-verified.png',fullPage:true});
 await page.setViewportSize({width:375,height:812});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

