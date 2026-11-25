import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {credentialsFile} from './environment.js';

test.beforeEach(async({page,baseURL})=>{
 const session=JSON.parse(await readFile(path.join(path.dirname(credentialsFile),'browser-session.json'),'utf8'));
 await page.context().addCookies([{name:'ir_session',value:session.cookie,url:baseURL!,httpOnly:true,sameSite:'Strict'}]);
 await page.goto('/#intelligence');await expect(page.getByRole('heading',{name:'Journey intelligence.'})).toBeVisible();
});

test('shows the untrained state and downloads a real source-separated dataset',async({page})=>{
 await expect(page.getByText('No SASRec model has been trained for this page and data source.')).toBeVisible();
 await page.getByLabel('Data source',{exact:true}).selectOption('seeded');
 const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download training sequences'}).click();
 const download=await downloadEvent,dataset=JSON.parse(await readFile((await download.path())!,'utf8'));
 expect(dataset.scope.data_source).toBe('seeded');expect(dataset.sequences.length).toBeGreaterThanOrEqual(10);
 expect(dataset.sequences[0].tokens[0]).toBe('page_view');expect(JSON.stringify(dataset)).not.toContain('view_id');
 await page.getByLabel('Data source',{exact:true}).selectOption('legacy');
 await expect(page.getByText('Unclassified historical activity cannot train this model.',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Download training sequences'})).toHaveCount(0);
});

test('builds history and renders ranking scores and evaluation with fixture model responses',async({page})=>{
 const evaluations={hit_rate:0.5,ndcg:0.4};
 await page.route('**/api/intelligence/status?*',route=>route.fulfill({json:{status:'ready',manifest:{schema_version:1,model:'SASRec',model_id:'browser-fixture',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),vocabulary:['page_view','exposure:hero-register','click:hero-register','activation:registration-start'],max_length:50,evaluation:{test_sequences:40,unknown_targets:1,k:3,sasrec:evaluations,markov:evaluations,popularity:evaluations}}}}));
 await page.route('**/api/intelligence/predict',async route=>{
  const request=route.request();expect(request.headers()['x-csrf-token']).toBeTruthy();
  expect(request.postDataJSON().history).toEqual(['page_view','click:hero-register']);
  await route.fulfill({json:{model:'SASRec',model_id:'browser-fixture',score_type:'ranking_logit',data_source:'seeded',rankings:[{action:'activation:registration-start',score:2.15},{action:'click:hero-register',score:-0.12}]}});
 });
 await page.getByLabel('Data source',{exact:true}).selectOption('seeded');
 await expect(page.getByRole('heading',{name:'Held-out evaluation'})).toBeVisible();
 await page.getByLabel('Observed action').selectOption('click:hero-register');await page.getByRole('button',{name:'Add action',exact:true}).click();
 await expect(page.locator('.intelligence-history li')).toHaveCount(2);
 await page.getByRole('button',{name:'Predict next action',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Likely next interactions'})).toBeVisible();
 await expect(page.getByRole('cell',{name:'2.150',exact:true})).toBeVisible();
 await expect(page.getByText('These scores are not calibrated probabilities.',{exact:false})).toBeVisible();
 await page.screenshot({path:'.local/evidence/intelligence-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'.local/evidence/intelligence-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Remove last',exact:true}).click();await expect(page.getByRole('heading',{name:'Likely next interactions'})).toHaveCount(0);
 await expect(page.locator('.intelligence-history li')).toHaveCount(1);
});

test('downloads, trains and displays an actual local SASRec prediction',async({page})=>{
 test.skip(!process.env.INFRARED_INTELLIGENCE_PYTHON,'Optional Python runtime is not configured');
 test.setTimeout(60000);
 await page.getByLabel('Data source',{exact:true}).selectOption('seeded');
 const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download training sequences'}).click();
 const dataset=(await (await downloadEvent).path())!;
 await promisify(execFile)(process.env.INFRARED_INTELLIGENCE_PYTHON!,['apps/intelligence/sasrec.py','train','--dataset',dataset,'--data-dir',process.env.E2E_DATA_DIR!,'--epochs','2','--hidden','8'],{timeout:30000,windowsHide:true});
 await page.getByRole('button',{name:'Refresh data',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Held-out evaluation'})).toBeVisible();
 const predictionEvent=page.waitForResponse(r=>r.url().endsWith('/api/intelligence/predict'));
 await page.getByRole('button',{name:'Predict next action',exact:true}).click();
 const prediction=await predictionEvent;expect(prediction.status()).toBe(200);
 const result=await prediction.json();expect(result.model).toBe('SASRec');expect(result.rankings.length).toBeGreaterThan(0);
 await expect(page.getByRole('heading',{name:'Likely next interactions'})).toBeVisible();
 await expect(page.getByRole('cell',{name:result.rankings[0].action,exact:true})).toBeVisible();
 await page.screenshot({path:'.local/evidence/intelligence-local-trained.png',fullPage:true});
});

test('trains EulerNet from observed windows and displays both actual model outputs together',async({page})=>{
 test.skip(!process.env.INFRARED_INTELLIGENCE_PYTHON,'Optional Python runtime is not configured');
 test.setTimeout(60000);
 await page.getByLabel('Data source',{exact:true}).selectOption('seeded');
 const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download click training examples'}).click();
 const dataset=(await (await downloadEvent).path())!;
 const parsed=JSON.parse(await readFile(dataset,'utf8'));expect(parsed.model).toBe('EulerNet');expect(parsed.views.length).toBeGreaterThanOrEqual(10);
 await promisify(execFile)(process.env.INFRARED_INTELLIGENCE_PYTHON!,['apps/intelligence/eulernet.py','train','--dataset',dataset,'--data-dir',process.env.E2E_DATA_DIR!,'--epochs','2','--width','4'],{timeout:30000,windowsHide:true});
 // Each browser test can run independently; ensure a matching SASRec checkpoint.
 const sequenceDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download training sequences'}).click();
 await promisify(execFile)(process.env.INFRARED_INTELLIGENCE_PYTHON!,['apps/intelligence/sasrec.py','train','--dataset',(await (await sequenceDownload).path())!,'--data-dir',process.env.E2E_DATA_DIR!,'--epochs','2','--hidden','8'],{timeout:30000,windowsHide:true});
 await page.getByRole('button',{name:'Refresh data',exact:true}).click();
 await expect(page.getByRole('heading',{name:'EulerNet click evaluation',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Analyze both models',exact:true})).toBeDisabled();
 await page.getByLabel('Observed action').selectOption('exposure:hero-register');await page.getByRole('button',{name:'Add action',exact:true}).click();
 const responseEvent=page.waitForResponse(r=>r.url().endsWith('/api/intelligence/analyze'));
 await page.getByRole('button',{name:'Analyze both models',exact:true}).click();
 const response=await responseEvent;expect(response.status()).toBe(200);const result=await response.json();expect(result.eulernet.validation_state).toBe('fixture_only');
 await expect(page.getByRole('heading',{name:'Likely next interactions'})).toBeVisible();
 await expect(page.getByRole('region',{name:'EulerNet click estimate'})).toContainText((100*result.eulernet.probability).toFixed(1)+'%');
 await expect(page.getByText('Both intelligence models are optional.',{exact:false})).toBeVisible();
 await page.screenshot({path:'.local/evidence/intelligence-both-models.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'.local/evidence/intelligence-both-models-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Remove last',exact:true}).click();await expect(page.getByRole('region',{name:'EulerNet click estimate'})).toHaveCount(0);
});
