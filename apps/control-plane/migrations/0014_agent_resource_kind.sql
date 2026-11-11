-- 0014_agent_resource_kind.sql — Agent-Identitaeten werden eine Ressource.
--
-- Die Tabelle `agent_identities` gibt es seit 0005, und ein Agent ist seit
-- 0003 ein **Subjekt** (`agent:<name>`). Wer eine Identitaet anlegen oder
-- sperren darf, stand nirgends: Es ging nur per SQL. Damit konnte kein Agent
-- ueber den Plattform-MCP arbeiten, ohne dass jemand vorher an der Datenbank
-- war — Grundsatz 1 aus CLAUDE.md (keine Aktion ohne API und MCP-Tool) war
-- genau an der Stelle verletzt, an der Agents ueberhaupt erst hereinkommen.
--
-- Mit dieser Zeile ist eine Agent-Identitaet auch eine Ressource. `read` auf
-- `agent:<name>` heisst: die Identitaet sehen (nie ihr Secret). `write`
-- heisst: sie sperren. `agent:*` gilt fuer alle und erlaubt zusaetzlich, neue
-- anzulegen — dieselbe Regel wie bei Gruppen (0011).
--
-- Zwei Dateien aus demselben Grund wie 0011/0012: Postgres laesst einen neuen
-- Enum-Wert nicht in der Transaktion benutzen, in der er entsteht.

ALTER TYPE grant_resource_kind ADD VALUE IF NOT EXISTS 'agent';
