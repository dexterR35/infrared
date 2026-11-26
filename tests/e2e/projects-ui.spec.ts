import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.route('**/api/**',async route=>{
  if(new URL(route.request().url()).pathname==='/api/bootstrap')return route.fulfill({json:{user:{email:'owner@example.test',role:'owner',csrf:'test'},sites:[{id:'project-one',name:'My clothing store',origin:'https://clothing.ro',brand:'Clothing',enabled:true,market:'RO',currency:'RON'}],pages:[],privacy:{raw_days:30,reference_days:30,minimum_views:20,global_stop:false}}});
  return route.fulfill({json:[]});
 });
 await page.goto('/#projects');
});

test('compact project cards and modal keyboard behavior',async({page})=>{
 const card=page.getByRole('region',{name:'My clothing store',exact:true});
 await expect(card).toHaveCount(1);
 expect((await card.boundingBox())!.width).toBeLessThan(500);
 const start=page.getByRole('button',{name:'Start new project'});
 await start.click();
 const dialog=page.getByRole('dialog',{name:'Start a project'});
 await expect(dialog).toBeVisible();
 await expect(page.getByLabel('Project name',{exact:true})).toBeFocused();
 await page.keyboard.press('Shift+Tab');
 await expect(dialog.getByRole('button',{name:'Close dialog'})).toBeFocused();
 await page.keyboard.press('Shift+Tab');
 await expect(dialog.getByRole('button',{name:'Create project',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);
 await expect(start).toBeFocused();
});

test('validates the form and preserves individual regional edits',async({page})=>{
 let submissions=0;
 await page.route('**/api/projects',async route=>{submissions++;return route.fulfill({status:409,json:{error:{code:'WEBSITE_ALREADY_EXISTS'}}});});
 await page.getByRole('button',{name:'Start new project'}).click();
 await page.getByRole('button',{name:'Create project',exact:true}).click();
 await expect(page.getByLabel('Project name',{exact:true})).toHaveAttribute('aria-invalid','true');
 expect(submissions).toBe(0);
 await page.getByLabel('Project name',{exact:true}).fill(' Store ');
 await page.getByLabel('Website address',{exact:true}).fill('https://store.ro');
 await expect(page.getByLabel('Market',{exact:true})).toHaveValue('RO');
 await expect(page.getByLabel('Currency',{exact:true})).toHaveValue('RON');
 await page.getByLabel('Currency',{exact:true}).fill('usd');
 await page.getByLabel('Website address',{exact:true}).fill('https://store.de');
 await expect(page.getByLabel('Market',{exact:true})).toHaveValue('DE');
 await expect(page.getByLabel('Currency',{exact:true})).toHaveValue('USD');
 await expect(page.getByLabel('Report time zone',{exact:true})).toHaveValue('Europe/Berlin');
 await page.getByLabel('Website address',{exact:true}).fill('https://store.de/path');
 await page.getByRole('button',{name:'Create project',exact:true}).click();
 await expect(page.getByLabel('Website address',{exact:true})).toBeFocused();
 expect(submissions).toBe(0);
 await page.getByLabel('Website address',{exact:true}).fill('https://store.de');
 const request=page.waitForRequest(request=>request.url().endsWith('/api/projects'));
 await page.getByRole('button',{name:'Create project',exact:true}).click();
 expect((await request).postDataJSON()).toMatchObject({name:'Store',url:'https://store.de',currency:'USD'});
 await expect(page.getByRole('alert')).toHaveText('A project already exists for this website.');
 await expect(page.getByRole('dialog')).toBeVisible();
});

test('mobile modal fits the screen and keeps actions reachable',async({page})=>{
 await page.setViewportSize({width:390,height:720});
 await page.getByRole('button',{name:'Start new project'}).click();
 const dialog=page.getByRole('dialog');
 const bounds=(await dialog.boundingBox())!;
 expect(bounds.x).toBeGreaterThanOrEqual(0);
 expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
 expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(dialog).toHaveCount(0);
});
