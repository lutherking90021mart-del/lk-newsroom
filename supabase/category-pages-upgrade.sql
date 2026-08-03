-- LK Newsroom category pages: run after schema.sql and live-news.sql.
-- Descriptions are stored in Supabase so public category page metadata is not hard-coded.
insert into public.categories(name,slug,description,colour) values
  ('Ghana','ghana','Latest breaking news, politics, business, sports and entertainment from Ghana.','#CE1126'),
  ('Politics','politics','Political news, policy, elections and public affairs from Ghana, Africa and the world.','#003366'),
  ('Business','business','Markets, companies, jobs, finance and economic news that matters.','#0057B8'),
  ('Technology','technology','Digital innovation, science, startups and technology shaping tomorrow.','#0A7897'),
  ('Entertainment','entertainment','Music, film, culture, celebrities and the creative industry.','#8B3F5E'),
  ('Sports','sports','Latest football, basketball, tennis and world sports news.','#12607D'),
  ('Health','health','Public health, wellness, medicine and healthcare reporting.','#0D7C66'),
  ('Education','education','Schools, universities, learning and education policy updates.','#7A5210'),
  ('Africa','africa','Breaking news, business, culture and politics from across Africa.','#0057B8'),
  ('World','world','Breaking international news from trusted sources.','#003366'),
  ('Opinion','opinion','Thoughtful commentary, analysis and perspectives on the issues that matter.','#4D3D88')
on conflict (slug) do update set
  name=excluded.name,
  description=excluded.description,
  colour=excluded.colour;
