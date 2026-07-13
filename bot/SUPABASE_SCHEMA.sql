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

-- ═══════════════════════════════════════════════════════════════════════
-- E-mails support (support@safix59.fr) — réception centralisée
-- ═══════════════════════════════════════════════════════════════════════
-- Chaque e-mail reçu sur support@safix59.fr est déposé ici par un webhook
-- (service de parsing d'e-mails → POST /api/admin?action=inbound-email).
-- Le Dashboard (onglet « E-mails support ») les liste, les marque lus /
-- traités et alerte l'admin (badge, compteur, notification).
--   status : 'non_lu' (nouveau, non consulté)
--            'lu'     (ouvert par l'admin)
--            'traite' (traité / clôturé)
create table if not exists public.support_emails (
  id           bigserial primary key,
  received_at  timestamptz not null default now(),
  from_email   text,
  from_name    text,
  subject      text not null default '(sans objet)',
  preview      text,                         -- extrait (≤280 car.) pour la liste
  body         text,                         -- corps texte nettoyé (≤20000 car.)
  status       text not null default 'non_lu',
  message_id   text,                         -- en-tête Message-Id (anti-doublon)
  created_at   timestamptz not null default now()
);

-- Tri principal (les plus récents d'abord) + filtre par statut.
create index if not exists support_emails_received_idx on public.support_emails (received_at desc);
create index if not exists support_emails_status_idx   on public.support_emails (status, received_at desc);
-- Anti-doublon : une même livraison (même Message-Id) n'est insérée qu'une fois.
-- (Les valeurs NULL restent autorisées et distinctes → aucun blocage si absent.)
create unique index if not exists support_emails_message_id_key on public.support_emails (message_id);

-- Sécurité : seule la clé service_role (côté serveur) accède à la table.
alter table public.support_emails enable row level security;
