# Leghrib Pharmacy — Gestion Prévisionnelle des Stocks V4

Outil de gestion et de prévision des stocks pour la Pharmacie Leghrib, Algérie.

## Description

L'application **Leghrib Pharmacy V4** est un système complet de gestion prévisionnelle des stocks conçu pour optimiser la gestion des médicaments et des articles de pharmacie. Elle combine l'importation de données Excel, la classification ABC/XYZ, l'analyse fournisseurs et le suivi des péremptions.

## Fonctionnalités Clés

- **Importation Excel** : Intégration facile de la nomenclature, de la rotation des stocks et des ventes mensuelles
- **Classification ABC/XYZ** : Analyse automatique pour identifier les produits critiques
- **Alertes Stock** : Notifications en temps réel pour les niveaux de stock faibles et les péremptions proches
- **Matching DCI** : Correspondance avec la base de données nationale DCI (Dénomination Commune Internationale)
- **Liste d'Achat** : Génération automatique des commandes basée sur les besoins prévus
- **Suivi Péremption** : Gestion complète des dates d'expiration
- **Analyse Fournisseurs** : Évaluation et comparaison des fournisseurs
- **Tableau de Bord** : Visualisation dynamique avec graphiques Chart.js
- **Correction DCI Manuelle** : Interface dédiée pour corriger les correspondances DCI

## Améliorations V4

- Correction de la barre de recherche pour améliorer la navigation
- Utilisation de la DCI nationale comme source primaire avec données de laboratoire
- Paramétrage des mois cibles pour la classification ABC/XYZ
- Page dédiée à la correction manuelle des correspondances DCI
- Rotation des stocks rendue optionnelle pour plus de flexibilité

## Stack Technologique

- **Frontend** : Vanilla JavaScript (ES6+)
- **Gestion Fichiers Excel** : SheetJS
- **Visualisation** : Chart.js
- **Styles** : CSS3 (variables CSS, Flexbox, Grid)

## Comment Utiliser

1. Ouvrir `pharmaplanV4.html` dans un navigateur web
2. Importer vos fichiers Excel (nomenclature, rotation, ventes mensuelles)
3. Configurer les paramètres dans l'onglet Paramètres
4. Consulter le tableau de bord pour une vue d'ensemble
5. Gérer les alertes, les correspondances DCI, les fournisseurs et les péremptions
6. Générer des listes d'achat basées sur les prévisions

## Structure des Fichiers

- `PharmaPlanv4.html` : Page HTML principale avec structure DOM
- `styles.css` : Feuille de styles CSS complète
- `app.js` : Logique applicative JavaScript

## Licence

Propriétaire - Leghrib Pharmacy

---

Développé avec vanilla JavaScript et SheetJS pour une solution complète de gestion prévisionnelle des stocks.
