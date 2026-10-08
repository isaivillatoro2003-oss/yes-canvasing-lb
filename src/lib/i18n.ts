import type { Lang } from "./types";

/**
 * Translation layer. English is complete; French and Arabic fall back to English
 * for any missing key, so new strings never break the UI. Arabic switches the
 * whole document to RTL (see LanguageEffect in app-context).
 * Seed vocabulary comes from the team's spreadsheet Dictionary tab.
 */
const en = {
  "nav.home": "Home",
  "nav.add": "Add",
  "nav.inventory": "Inventory",
  "nav.reports": "Reports",
  "nav.more": "More",
  "nav.dashboard": "Dashboard",
  "nav.team": "Team",
  "nav.users": "Users",
  "nav.finance": "Finance",
  "nav.settings": "Settings",
  "welcome.title": "Welcome to YES",
  "welcome.subtitle": "Youth Education Scholarship",
  "auth.signIn": "Sign In",
  "auth.createAccount": "Create Account",
  "home.hello": "Hello",
  "home.startWork": "START WORK",
  "home.stopWork": "STOP WORK",
  "home.workingNow": "WORKING NOW",
  "home.notWorking": "Ready when you are",
  "home.books": "Books",
  "home.bookValue": "Book Value",
  "home.donations": "Donations",
  "home.received": "Received",
  "home.workTime": "Work Time",
  "home.presentations": "Presentations",
  "home.newTransaction": "New Transaction",
  "home.myInventory": "My Inventory",
  "home.todaysReport": "Today's Report",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.saving": "Saving…",
  "sync.waiting": "Waiting to sync",
  "sync.synced": "Synced",
  "sync.offline": "You're offline",
};

export type TKey = keyof typeof en;

const fr: Partial<Record<TKey, string>> = {
  "nav.home": "Accueil",
  "nav.add": "Ajouter",
  "nav.inventory": "Inventaire",
  "nav.reports": "Rapports",
  "nav.more": "Plus",
  "nav.dashboard": "Tableau",
  "nav.team": "Équipe",
  "nav.users": "Utilisateurs",
  "nav.finance": "Finances",
  "nav.settings": "Réglages",
  "welcome.title": "Bienvenue à YES",
  "auth.signIn": "Se connecter",
  "auth.createAccount": "Créer un compte",
  "home.hello": "Bonjour",
  "home.startWork": "COMMENCER",
  "home.stopWork": "TERMINER",
  "home.workingNow": "EN TRAVAIL",
  "home.books": "Livres",
  "home.bookValue": "Valeur des livres",
  "home.donations": "Dons",
  "home.received": "Reçu",
  "home.workTime": "Heures",
  "home.presentations": "Présentations",
  "home.newTransaction": "Nouvelle vente",
  "home.myInventory": "Mon inventaire",
  "home.todaysReport": "Rapport du jour",
  "common.save": "Enregistrer",
  "common.cancel": "Annuler",
};

const ar: Partial<Record<TKey, string>> = {
  "nav.home": "الرئيسية",
  "nav.add": "إضافة",
  "nav.inventory": "المخزون",
  "nav.reports": "التقارير",
  "nav.more": "المزيد",
  "nav.dashboard": "لوحة التحكم",
  "nav.team": "الفريق",
  "nav.users": "المستخدمون",
  "nav.finance": "المالية",
  "nav.settings": "الإعدادات",
  "welcome.title": "مرحباً بك في YES",
  "auth.signIn": "تسجيل الدخول",
  "auth.createAccount": "إنشاء حساب",
  "home.hello": "مرحباً",
  "home.startWork": "ابدأ العمل",
  "home.stopWork": "أوقف العمل",
  "home.workingNow": "تعمل الآن",
  "home.books": "كتب",
  "home.bookValue": "قيمة الكتب",
  "home.donations": "تبرعات",
  "home.received": "المستلم",
  "home.workTime": "ساعات",
  "home.presentations": "عروض",
  "home.newTransaction": "عملية جديدة",
  "home.myInventory": "مخزوني",
  "home.todaysReport": "تقرير اليوم",
  "common.save": "حفظ",
  "common.cancel": "إلغاء",
};

const dictionaries: Record<Lang, Partial<Record<TKey, string>>> = { en, fr, ar };

export function translate(lang: Lang, key: TKey): string {
  return dictionaries[lang]?.[key] ?? en[key];
}

export const LANGS: { code: Lang; label: string; dir: "ltr" | "rtl" }[] = [
  { code: "en", label: "English", dir: "ltr" },
  { code: "fr", label: "Français", dir: "ltr" },
  { code: "ar", label: "العربية", dir: "rtl" },
];
