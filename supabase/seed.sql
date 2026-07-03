-- Seed: real Bangalore spots so the map is alive on first load.
-- Run after 0001_init.sql. Safe to re-run (deletes curated rows first).

delete from public.places where source = 'curated';

insert into public.places
  (title, description, category, lat, lng, address, area, source_url, event_start, event_end, status, source)
values
  ('Toit Brewpub',
   'The Indiranagar institution. Wood-fired pizzas, the Toit Weiss, and a wait on weekends that is somehow always worth it.',
   'drinks', 12.9718, 77.6404, '298, 100 Feet Road', 'Indiranagar', 'https://toit.in', null, null, 'approved', 'curated'),

  ('VV Puram Food Street',
   'Thindi Beedi — one lane, a hundred stalls. Dosa, obbattu, gulkand, congress bun. Go hungry, go after 6pm.',
   'food', 12.9457, 77.5736, 'Sajjan Rao Circle, VV Puram', 'Basavanagudi', null, null, null, 'approved', 'curated'),

  ('Blossom Book House',
   'Three floors of second-hand books stacked to the ceiling on Church Street. You will lose two hours here minimum.',
   'shopping', 12.9757, 77.6011, '84/6, Church Street', 'MG Road', null, null, null, 'approved', 'curated'),

  ('Cubbon Park',
   '300 acres of green in the middle of the city. Cubbon Reads on Saturday mornings, dog park energy on Sundays.',
   'outdoors', 12.9763, 77.5929, 'Kasturba Road', 'Central Bengaluru', null, null, null, 'approved', 'curated'),

  ('Lalbagh Botanical Garden',
   '240-year-old garden with a glasshouse, a 3-billion-year-old rock, and the best sunrise walk in south Bengaluru.',
   'outdoors', 12.9507, 77.5848, 'Mavalli', 'Lalbagh', null, null, null, 'approved', 'curated'),

  ('The Rameshwaram Cafe',
   'The ghee podi idli that broke the internet. Expect a queue; it moves fast. Cash-counter chaos is part of the experience.',
   'food', 12.9698, 77.6383, '80 Feet Road', 'Indiranagar', null, null, null, 'approved', 'curated'),

  ('Museum of Art & Photography (MAP)',
   'World-class private art museum on Kasturba Road. Rotating exhibitions, great rooftop café, free entry on some evenings.',
   'art_culture', 12.9727, 77.5966, '22 Kasturba Road', 'Central Bengaluru', 'https://map-india.org', null, null, 'approved', 'curated'),

  ('Byg Brewski Brewing Company',
   'One of the biggest brewpubs in Asia — lakeside seating, live gigs, and a menu longer than your weekend.',
   'drinks', 13.0459, 77.6486, 'Behind Royal Orchid', 'Hennur', null, null, null, 'approved', 'curated'),

  ('Commercial Street',
   'The OG shopping crawl: fabric, footwear, filter coffee breaks. Bargain hard, then reward yourself at Albert Bakery nearby.',
   'shopping', 12.9822, 77.6089, 'Commercial Street', 'Shivajinagar', null, null, null, 'approved', 'curated'),

  ('Nandi Hills Sunrise',
   'The 4:30am club. Ride out, catch the sea of clouds at sunrise, breakfast in Chikkaballapur on the way back.',
   'experience', 13.3702, 77.6835, 'Nandi Hills', 'Outskirts', null, null, null, 'approved', 'curated'),

  ('Church Street Social',
   'Church Street''s living room — work-from-café by day, gigs and cocktails by night, people-watching always.',
   'nightlife', 12.9752, 77.6047, '46/1, Church Street', 'MG Road', null, null, null, 'approved', 'curated'),

  ('The Bier Library',
   'Koramangala''s craft-beer sanctuary. Belgian-style brews, open-air deck, quieter than the 100ft Road crowd.',
   'drinks', 12.9349, 77.6301, '600 Feet Road, 4th Block', 'Koramangala', null, null, null, 'approved', 'curated'),

  ('Ranga Shankara',
   'A play a day, 365 days a year. The heart of Bengaluru theatre — ₹200 tickets, world-class productions.',
   'art_culture', 12.9092, 77.5857, '36/2, 8th Cross, JP Nagar 2nd Phase', 'JP Nagar', 'https://rangashankara.org', null, null, 'approved', 'curated'),

  ('Sunday Soul Sante',
   'Flea market carnival: 300+ indie brands, food trucks, live music. The plan-your-Sunday default.',
   'event', 13.0069, 77.5924, 'Jayamahal Palace Grounds', 'Jayamahal',
   'https://soulsante.in',
   date_trunc('week', now()) + interval '5 days 10 hours',
   date_trunc('week', now()) + interval '5 days 20 hours',
   'approved', 'curated'),

  ('Gig Night at Fandom',
   'Indie and metal gigs at Gilly''s Redefined rooftop. Check the lineup — someone good is always passing through.',
   'event', 12.9337, 77.6141, 'Gilly''s Redefined, 5th Block', 'Koramangala',
   'https://insider.in',
   date_trunc('week', now()) + interval '4 days 19 hours',
   date_trunc('week', now()) + interval '4 days 23 hours',
   'approved', 'curated'),

  ('Corner House Ice Cream',
   'Death by Chocolate. That''s it. That''s the description.',
   'food', 12.9668, 77.6069, 'Residency Road', 'Richmond Town', null, null, null, 'approved', 'curated');

-- Placeholder photos for the curated seeds (replace with real pics via the
-- dashboard or future admin edit — picsum images are stable per seed).
update public.places set image_url = 'https://picsum.photos/seed/' || seed || '/600/400'
from (values
  ('Toit Brewpub', 'toit'),
  ('VV Puram Food Street', 'vvpuram'),
  ('Blossom Book House', 'blossom'),
  ('Cubbon Park', 'cubbon'),
  ('Lalbagh Botanical Garden', 'lalbagh'),
  ('The Rameshwaram Cafe', 'rameshwaram'),
  ('Museum of Art & Photography (MAP)', 'mapmuseum'),
  ('Byg Brewski Brewing Company', 'bygbrewski'),
  ('Commercial Street', 'commercial'),
  ('Nandi Hills Sunrise', 'nandihills'),
  ('Church Street Social', 'churchstreet'),
  ('The Bier Library', 'bierlibrary'),
  ('Ranga Shankara', 'rangashankara'),
  ('Sunday Soul Sante', 'soulsante'),
  ('Gig Night at Fandom', 'fandom'),
  ('Corner House Ice Cream', 'cornerhouse')
) as pics(title, seed)
where places.title = pics.title and places.source = 'curated';
