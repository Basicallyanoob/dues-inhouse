-- Starter banners: a standard set and four free defaults, all with placeholder
-- art until officers upload pictures on the admin page. Run once after
-- schema.sql. Rename or retire any of these from Admin > Banners.

insert into banner_sets (slug, name, description, kind, active, roll_cost, pity, sort)
values ('standard', 'DUES Standard', 'The permanent collection. Always in the shop.', 'standard', true, 1000, 60, 0)
on conflict (slug) do nothing;

insert into banners (name, rarity, set_id, is_default, buyable)
select v.name, v.rarity, case when v.is_default then null else (select id from banner_sets where slug = 'standard') end,
       v.is_default, v.buyable
from (values
  ('Periwinkle', 'common', true, false),
  ('Celtic Blue', 'common', true, false),
  ('Front Square', 'common', true, false),
  ('Night Lobby', 'common', true, false),
  ('First Pick', 'common', false, false),
  ('Warm-up', 'common', false, false),
  ('Comms On', 'common', false, false),
  ('Backline', 'common', false, false),
  ('Map Vote', 'common', false, false),
  ('Overtime', 'rare', false, false),
  ('Clutch Round', 'rare', false, false),
  ('Payload', 'rare', false, false),
  ('Spike Down', 'rare', false, true),
  ('Trinity Bells', 'epic', false, false),
  ('Captain''s Call', 'epic', false, true),
  ('Ace', 'legendary', false, false),
  ('Team Wipe', 'legendary', false, true),
  ('The Crest', 'ultimate', false, false)
) as v(name, rarity, is_default, buyable)
where not exists (select 1 from banners);

update banner_sets set featured_banner_id = (select id from banners where name = 'The Crest')
where slug = 'standard' and featured_banner_id is null;
