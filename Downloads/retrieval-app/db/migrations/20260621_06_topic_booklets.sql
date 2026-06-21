-- STATUS: NOT YET APPLIED. Apply to project uvzukwoxqhcxaxtzrziy when rolling the
-- public-booklet pilot out.
--
-- Canonical mapping: a retrieval `topic` -> its public revision booklet on
-- interactive-science.com. Single source of truth for "one pipeline, two
-- surfaces": feynman-education shows authors when a topic is also live on a public
-- booklet, and add_retrieval_widget.py can read the mapping from here.
--
-- The mapping is non-sensitive (it only says "this topic has a public booklet"),
-- so it is anon-readable. Generated from /tmp/gen_booklet_map.py.

create table if not exists public.topic_booklets (
  topic_id   uuid primary key references public.topics(id) on delete cascade,
  slug       text not null,
  url        text not null,
  created_at timestamptz not null default now()
);

alter table public.topic_booklets enable row level security;

drop policy if exists "topic_booklets readable by all" on public.topic_booklets;
create policy "topic_booklets readable by all"
  on public.topic_booklets for select
  to anon, authenticated
  using (true);

insert into public.topic_booklets (topic_id, slug, url) values
  ('5356c6ee-b7a1-4879-bc32-c7a102290a26', 'b1-cell-biology-gcse-revision', 'https://interactive-science.com/b1-cell-biology-gcse-revision.html'),
  ('0c6ed3d1-ce7e-43ea-8754-0f3d8fb1a23d', 'b2-organisation-gcse-revision', 'https://interactive-science.com/b2-organisation-gcse-revision.html'),
  ('9e31cf71-aff4-4ce1-803d-a12cd54d3e25', 'b3-infection-response-gcse-revision', 'https://interactive-science.com/b3-infection-response-gcse-revision.html'),
  ('cdad6594-a267-4d7b-bc1e-c437a57251d2', 'b4-bioenergetics-gcse-revision', 'https://interactive-science.com/b4-bioenergetics-gcse-revision.html'),
  ('6e0d9174-bfc5-429b-a25b-4f57ff31491b', 'c1-atomic-structure-gcse-revision', 'https://interactive-science.com/c1-atomic-structure-gcse-revision.html'),
  ('94ac04ee-0f4c-4e42-b327-0d1c5b0f0428', 'c2-bonding-structure-gcse-revision', 'https://interactive-science.com/c2-bonding-structure-gcse-revision.html'),
  ('33b95ad4-dc4e-42e1-b8ba-ad9ce60129ee', 'c3-quantitative-chemistry-gcse-revision', 'https://interactive-science.com/c3-quantitative-chemistry-gcse-revision.html'),
  ('f26a5c4c-2da5-4494-923f-7101e0a33801', 'c4-chemical-changes-gcse-revision', 'https://interactive-science.com/c4-chemical-changes-gcse-revision.html'),
  ('8d8c9ddc-fa6d-45cc-985a-3893a68bc9cf', 'c5-energy-changes-gcse-revision', 'https://interactive-science.com/c5-energy-changes-gcse-revision.html'),
  ('7d626032-ad67-499c-ac8e-c39afbad4a09', 'p2-electricity-gcse-revision', 'https://interactive-science.com/p2-electricity-gcse-revision.html'),
  ('5eef9c7e-83f2-447f-8aac-4cfe4b671ad7', 'p3-particle-model-gcse-revision', 'https://interactive-science.com/p3-particle-model-gcse-revision.html'),
  ('ccbdf76b-682d-4ddd-b936-727d397f68e2', 'p4-atomic-structure-gcse-revision', 'https://interactive-science.com/p4-atomic-structure-gcse-revision.html'),
  ('0a404d27-af38-4c89-883d-e3985da2d01a', 'energy-gcse-revision', 'https://interactive-science.com/energy-gcse-revision.html'),
  ('41c58a11-813f-2605-6e8f-ee9a797a8025', 'acids-and-alkalis-revision', 'https://interactive-science.com/acids-and-alkalis-revision.html'),
  ('942a8854-bf88-f61e-8337-efe1d8cb282a', 'atoms-revision', 'https://interactive-science.com/atoms-revision.html'),
  ('805f74f8-1d2b-7be1-36a3-ded3b8215d15', 'cells-revision', 'https://interactive-science.com/cells-revision.html'),
  ('6b107a61-cc16-3cd1-4752-33a8919af0df', 'chemical-reactions-revision', 'https://interactive-science.com/chemical-reactions-revision.html'),
  ('0481c709-0e99-fb00-dcdf-dd4b0b384cd7', 'diet-and-health-revision', 'https://interactive-science.com/diet-and-health-revision.html'),
  ('becd8fe8-9889-4c19-e30c-9f63a0d8b4ae', 'digestion-revision', 'https://interactive-science.com/digestion-revision.html'),
  ('e9cc62ba-a2a4-a8aa-8464-51e8a27f7623', 'elements-and-compounds-revision', 'https://interactive-science.com/elements-and-compounds-revision.html'),
  ('54f133a0-2ba2-486c-8334-2ee0a790dcbe', 'energy-changes-revision', 'https://interactive-science.com/energy-changes-revision.html'),
  ('7990e071-5ccc-0e81-67fe-a2320ba31a0a', 'energy-resources-revision', 'https://interactive-science.com/energy-resources-revision.html'),
  ('b7485ab6-4b3d-8b5d-495e-f1c25abee2fe', 'energy-revision', 'https://interactive-science.com/energy-revision.html'),
  ('f5a900e7-a2cb-4bd1-6eaa-33a3b44e75c8', 'forces-and-motion-revision', 'https://interactive-science.com/forces-and-motion-revision.html'),
  ('f796cd3f-62d0-8997-9a17-88327475d7da', 'gas-exchange-revision', 'https://interactive-science.com/gas-exchange-revision.html'),
  ('eb3d442f-9c74-4dc7-8064-c511e00cef8d', 'genetics-revision', 'https://interactive-science.com/genetics-revision.html'),
  ('264d6c36-900e-9349-20a8-7e9f1d33dbb7', 'light-revision', 'https://interactive-science.com/light-revision.html'),
  ('f088b317-a9bb-328a-e103-d37dcc6ecf04', 'particle-model-revision', 'https://interactive-science.com/particle-model-revision.html'),
  ('41b46a87-6a4e-a427-4867-3145c9da7d9e', 'reproduction-revision', 'https://interactive-science.com/reproduction-revision.html'),
  ('e35981cb-78d4-0dba-441d-b46e4143891a', 'separation-techniques-revision', 'https://interactive-science.com/separation-techniques-revision.html'),
  ('3356f7f2-10e1-9df1-ca9f-32d4fbe12239', 'skeleton-and-muscles-revision', 'https://interactive-science.com/skeleton-and-muscles-revision.html'),
  ('8e6fa525-3ba2-ba7f-d3f3-c6c354d4c195', 'sound-revision', 'https://interactive-science.com/sound-revision.html'),
  ('f61146d8-b0e6-4ab2-b203-4a175f66a67c', 'b5-homeostasis-response-gcse-revision', 'https://interactive-science.com/b5-homeostasis-response-gcse-revision.html'),
  ('027bdbd1-ebe7-4842-9008-86baaf1cb3ba', 'b6-inheritance-variation-evolution-gcse-revision', 'https://interactive-science.com/b6-inheritance-variation-evolution-gcse-revision.html'),
  ('8df5fab6-6a9b-4468-8d54-8293f1417618', 'b7-ecology-gcse-revision', 'https://interactive-science.com/b7-ecology-gcse-revision.html'),
  ('b187ae8f-27ee-467a-b538-c1d859d68afe', 'c6-rate-of-reaction-gcse-revision', 'https://interactive-science.com/c6-rate-of-reaction-gcse-revision.html'),
  ('30c00a66-5288-414f-996c-358633063fb4', 'c7-organic-chemistry-gcse-revision', 'https://interactive-science.com/c7-organic-chemistry-gcse-revision.html'),
  ('58c96f4d-04e9-4809-85f0-e940d263e902', 'c8-chemical-analysis-gcse-revision', 'https://interactive-science.com/c8-chemical-analysis-gcse-revision.html'),
  ('11562698-09b9-442f-a948-a4266d0712a8', 'c9-atmosphere-gcse-revision', 'https://interactive-science.com/c9-atmosphere-gcse-revision.html'),
  ('d22bc2b9-d977-4d48-b811-6731d97aaa92', 'c10-using-resources-gcse-revision', 'https://interactive-science.com/c10-using-resources-gcse-revision.html'),
  ('3abd8e06-b917-4d42-9a26-9c9b0dd6c400', 'p5-forces-gcse-revision', 'https://interactive-science.com/p5-forces-gcse-revision.html'),
  ('6e64b531-ead3-481c-8d33-cdb069f2b024', 'p6-waves-gcse-revision', 'https://interactive-science.com/p6-waves-gcse-revision.html'),
  ('4f97b092-441b-4d2a-89a8-af49af8dda2e', 'p7-magnetism-electromagnetism-gcse-revision', 'https://interactive-science.com/p7-magnetism-electromagnetism-gcse-revision.html')
on conflict (topic_id) do update set slug = excluded.slug, url = excluded.url;

comment on table public.topic_booklets is
  'Maps a retrieval topic to its public interactive-science.com revision booklet (one pipeline, two surfaces). See 20260621_06.';
