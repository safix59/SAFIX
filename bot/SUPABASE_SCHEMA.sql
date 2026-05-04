-- ═══════════════════════════════════════════════════════════════════════
-- SAFIX — Schéma Supabase
-- ═══════════════════════════════════════════════════════════════════════
-- À exécuter dans : Supabase Dashboard → SQL Editor → Run
-- Crée la table `orders` qui stocke chaque commande client + son cycle de
-- vie (paid → ordering → ordered / refunded / failed).

-- Table principale des commandes
create table if not exists public.orders (
  id                     bigserial primary key,
  stripe_session_id      text unique not null,
  stripe_payment_intent  text,
  customer_email         text not null,
  total_cents            integer not null,
  currency               text default 'eur',
  status                 text not null default 'paid',
  -- statuts possibles :
  --   paid       : paiement reçu, en attente de traitement par le bot
  --   ordering   : bot en train de passer commande sur Utopya
  --   ordered    : commande Utopya réussie (avec utopya_order_id)
  --   failed     : impossible de passer commande, à investiguer manuellement
  --   refunded   : commande échouée + refund Stripe automatique fait
  utopya_order_id        text,
  eta_date               date,
  line_items             jsonb,
  metadata               jsonb,
  error_message          text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Index pour le polling rapide du bot
create index if not exists orders_status_idx on public.orders (status, created_at);

-- Permissions : seulement la clé service_role peut lire/écrire
-- (la clé anon n'a aucun accès → sécurité)
alter table public.orders enable row level security;

-- Aucune policy → personne sauf service_role ne peut accéder.
-- (Pas besoin de policy : sans policy + RLS activé, tout est bloqué pour
-- anon. service_role bypass RLS.)

-- ═══════════════════════════════════════════════════════════════════════
-- Optionnel : table d'événements (audit trail) — utile pour debug
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.order_events (
  id          bigserial primary key,
  order_id    bigint references public.orders(id) on delete cascade,
  event_type  text not null,        -- 'webhook_received', 'order_placed', 'refund_issued', etc.
  payload     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events (order_id, created_at);
alter table public.order_events enable row level security;
