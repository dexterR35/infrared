-- Projects created before market defaults existed kept market NULL, currency XXX and UTC.
-- Fill those from the country domain once; anything already configured is left alone.
WITH defaults(tld,market,currency,tz) AS (VALUES
 ('ro','RO','RON','Europe/Bucharest'),('md','MD','MDL','Europe/Chisinau'),('uk','UK','GBP','Europe/London'),
 ('ie','IE','EUR','Europe/Dublin'),('de','DE','EUR','Europe/Berlin'),('at','AT','EUR','Europe/Vienna'),
 ('ch','CH','CHF','Europe/Zurich'),('fr','FR','EUR','Europe/Paris'),('be','BE','EUR','Europe/Brussels'),
 ('nl','NL','EUR','Europe/Amsterdam'),('es','ES','EUR','Europe/Madrid'),('pt','PT','EUR','Europe/Lisbon'),
 ('it','IT','EUR','Europe/Rome'),('gr','GR','EUR','Europe/Athens'),('pl','PL','PLN','Europe/Warsaw'),
 ('cz','CZ','CZK','Europe/Prague'),('sk','SK','EUR','Europe/Bratislava'),('hu','HU','HUF','Europe/Budapest'),
 ('bg','BG','BGN','Europe/Sofia'),('hr','HR','EUR','Europe/Zagreb'),('rs','RS','RSD','Europe/Belgrade'),
 ('se','SE','SEK','Europe/Stockholm'),('no','NO','NOK','Europe/Oslo'),('dk','DK','DKK','Europe/Copenhagen'),
 ('fi','FI','EUR','Europe/Helsinki'),('us','US','USD','America/New_York'),('ca','CA','CAD','America/Toronto'),
 ('au','AU','AUD','Australia/Sydney'))
UPDATE sites s SET market=d.market,currency=d.currency,report_timezone=d.tz
FROM defaults d
WHERE s.environment='real' AND s.market IS NULL AND s.currency='XXX' AND s.report_timezone='UTC'
 AND d.tld=lower(regexp_replace(s.domain_group,'^.*\.',''));
