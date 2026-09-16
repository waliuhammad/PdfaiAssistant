/**
 * UI copy, keyed by message id.
 *
 * English is the source. Every other locale is looked up against it and falls
 * back to it per key, so a catalogue that gains a key later needs no other
 * change.
 *
 * The settings dropdown used to offer 58 languages while three had copy, so
 * choosing one of the other 55 looked identical to the setting being broken.
 * The list is now exactly the languages translated here — adding a language
 * means adding a catalogue below and nothing else.
 */

const en = {
    "nav.dashboard": "Dashboard",
    "nav.tools": "Tools",
    "nav.settings": "Settings",
    "nav.logout": "Log out",
    "nav.upgradeTitle": "Upgrade to Pro",
    "nav.upgradeBody": "Unlock unlimited tools & more.",
    "nav.upgradeCta": "Upgrade Now",

    "dashboard.welcome": "Welcome back",
    "dashboard.subtitle": "Your plan and every tool, in one place.",
    "dashboard.quickActions": "Quick Actions",
    "dashboard.freePlan": "Free Plan",
    "dashboard.paidPlan": "Paid Plan",
    "dashboard.aiTools": "AI Tools",

    "usage.title": "Tools Usage Today",
    "usage.plan": "{plan} plan",
    "usage.used": "{used} of {limit} operations used",
    "usage.limitReached": "Limit reached — {used} of {limit} operations used",
    "usage.upgrade": "Upgrade for a higher daily allowance →",

    "settings.title": "Settings",
    "settings.profile": "Profile",
    "settings.theme": "Theme",
    "settings.notifications": "Notifications",
    "settings.password": "Password",
    "settings.language": "Language",
    "settings.billing": "Subscription & Billing",
    "settings.team": "Team",
    "settings.interfaceLanguage": "Interface language",
    "settings.searchLanguages": "Search languages...",

    "tools.allTools": "All Tools",
    "tools.available": "{count} tools available",
    "tools.availableOne": "1 tool available",
    "tools.search": "Search tools...",
    "tools.noMatch": "No tools match",
    "tools.heading": "All PDF Tools",
    "tools.subtitle": "Convert, edit, compress, organise and secure your PDF files in one place.",
    "tools.badge": "PDF Toolkit",
    "common.cancel": "Cancel",
    "common.save": "Save",
    "common.delete": "Delete",
    "common.download": "Download",
    "common.close": "Close",
    "common.loading": "Loading...",
};

const es: Partial<typeof en> = {
    "nav.dashboard": "Panel",
    "nav.tools": "Herramientas",
    "nav.settings": "Ajustes",
    "nav.logout": "Cerrar sesión",
    "nav.upgradeTitle": "Mejora a Pro",
    "nav.upgradeBody": "Herramientas ilimitadas y mucho más.",
    "nav.upgradeCta": "Mejorar ahora",

    "dashboard.welcome": "Bienvenido de nuevo",
    "dashboard.subtitle": "Tu plan y todas las herramientas, en un solo lugar.",
    "dashboard.quickActions": "Acciones rápidas",
    "dashboard.freePlan": "Plan gratuito",
    "dashboard.paidPlan": "Plan de pago",
    "dashboard.aiTools": "Herramientas IA",

    "usage.title": "Uso de herramientas hoy",
    "usage.plan": "plan {plan}",
    "usage.used": "{used} de {limit} operaciones usadas",
    "usage.limitReached": "Límite alcanzado — {used} de {limit} operaciones usadas",
    "usage.upgrade": "Mejora tu plan para un límite diario mayor →",

    "settings.title": "Ajustes",
    "settings.profile": "Perfil",
    "settings.theme": "Tema",
    "settings.notifications": "Notificaciones",
    "settings.password": "Contraseña",
    "settings.language": "Idioma",
    "settings.billing": "Suscripción y facturación",
    "settings.team": "Equipo",
    "settings.interfaceLanguage": "Idioma de la interfaz",
    "settings.searchLanguages": "Buscar idiomas...",

    "tools.allTools": "Todas las herramientas",
    "tools.available": "{count} herramientas disponibles",
    "tools.availableOne": "1 herramienta disponible",
    "tools.search": "Buscar herramientas...",
    "tools.noMatch": "Ninguna herramienta coincide",
    "tools.heading": "Todas las herramientas PDF",
    "tools.subtitle": "Convierte, edita, comprime, organiza y protege tus archivos PDF en un solo lugar.",
    "tools.badge": "Kit PDF",
    "common.cancel": "Cancelar",
    "common.save": "Guardar",
    "common.delete": "Eliminar",
    "common.download": "Descargar",
    "common.close": "Cerrar",
    "common.loading": "Cargando...",
};

const fr: Partial<typeof en> = {
    "nav.dashboard": "Tableau de bord",
    "nav.tools": "Outils",
    "nav.settings": "Paramètres",
    "nav.logout": "Se déconnecter",
    "nav.upgradeTitle": "Passer à Pro",
    "nav.upgradeBody": "Outils illimités et plus encore.",
    "nav.upgradeCta": "Passer à Pro",

    "dashboard.welcome": "Bon retour",
    "dashboard.subtitle": "Votre forfait et tous les outils, au même endroit.",
    "dashboard.quickActions": "Actions rapides",
    "dashboard.freePlan": "Formule gratuite",
    "dashboard.paidPlan": "Formule payante",
    "dashboard.aiTools": "Outils IA",

    "usage.title": "Utilisation des outils aujourd'hui",
    "usage.plan": "formule {plan}",
    "usage.used": "{used} opérations sur {limit} utilisées",
    "usage.limitReached": "Limite atteinte — {used} opérations sur {limit} utilisées",
    "usage.upgrade": "Passez à une formule supérieure pour un quota quotidien plus élevé →",

    "settings.title": "Paramètres",
    "settings.profile": "Profil",
    "settings.theme": "Thème",
    "settings.notifications": "Notifications",
    "settings.password": "Mot de passe",
    "settings.language": "Langue",
    "settings.billing": "Abonnement et facturation",
    "settings.team": "Équipe",
    "settings.interfaceLanguage": "Langue de l'interface",
    "settings.searchLanguages": "Rechercher une langue...",

    "tools.allTools": "Tous les outils",
    "tools.available": "{count} outils disponibles",
    "tools.availableOne": "1 outil disponible",
    "tools.search": "Rechercher un outil...",
    "tools.noMatch": "Aucun outil ne correspond",
    "tools.heading": "Tous les outils PDF",
    "tools.subtitle": "Convertissez, modifiez, compressez, organisez et sécurisez vos PDF au même endroit.",
    "tools.badge": "Boîte à outils PDF",
    "common.cancel": "Annuler",
    "common.save": "Enregistrer",
    "common.delete": "Supprimer",
    "common.download": "Télécharger",
    "common.close": "Fermer",
    "common.loading": "Chargement...",
};

const de: Partial<typeof en> = {
    "nav.dashboard": "Übersicht",
    "nav.tools": "Werkzeuge",
    "nav.settings": "Einstellungen",
    "nav.logout": "Abmelden",
    "nav.upgradeTitle": "Auf Pro upgraden",
    "nav.upgradeBody": "Unbegrenzte Tools und mehr.",
    "nav.upgradeCta": "Jetzt upgraden",

    "dashboard.welcome": "Willkommen zurück",
    "dashboard.subtitle": "Ihr Tarif und alle Werkzeuge an einem Ort.",
    "dashboard.quickActions": "Schnellaktionen",
    "dashboard.freePlan": "Gratis-Tarif",
    "dashboard.paidPlan": "Bezahltarif",
    "dashboard.aiTools": "KI-Werkzeuge",

    "usage.title": "Heutige Nutzung",
    "usage.plan": "Tarif {plan}",
    "usage.used": "{used} von {limit} Vorgängen genutzt",
    "usage.limitReached": "Limit erreicht — {used} von {limit} Vorgängen genutzt",
    "usage.upgrade": "Upgraden für ein höheres Tageslimit →",

    "settings.title": "Einstellungen",
    "settings.profile": "Profil",
    "settings.theme": "Design",
    "settings.notifications": "Benachrichtigungen",
    "settings.password": "Passwort",
    "settings.language": "Sprache",
    "settings.billing": "Abo und Abrechnung",
    "settings.team": "Team",
    "settings.interfaceLanguage": "Sprache der Oberfläche",
    "settings.searchLanguages": "Sprachen suchen...",

    "tools.allTools": "Alle Werkzeuge",
    "tools.available": "{count} Werkzeuge verfügbar",
    "tools.availableOne": "1 Werkzeug verfügbar",
    "tools.search": "Werkzeuge suchen...",
    "tools.noMatch": "Kein Werkzeug passt zu",
    "tools.heading": "Alle PDF-Werkzeuge",
    "tools.subtitle": "PDF-Dateien an einem Ort umwandeln, bearbeiten, komprimieren, ordnen und schützen.",
    "tools.badge": "PDF-Werkzeugkasten",
    "common.cancel": "Abbrechen",
    "common.save": "Speichern",
    "common.delete": "Löschen",
    "common.download": "Herunterladen",
    "common.close": "Schließen",
    "common.loading": "Wird geladen...",
};

const pt: Partial<typeof en> = {
    "nav.dashboard": "Painel",
    "nav.tools": "Ferramentas",
    "nav.settings": "Configurações",
    "nav.logout": "Sair",
    "nav.upgradeTitle": "Assine o Pro",
    "nav.upgradeBody": "Ferramentas ilimitadas e muito mais.",
    "nav.upgradeCta": "Assinar agora",

    "dashboard.welcome": "Bem-vindo de volta",
    "dashboard.subtitle": "Seu plano e todas as ferramentas, em um só lugar.",
    "dashboard.quickActions": "Ações rápidas",
    "dashboard.freePlan": "Plano gratuito",
    "dashboard.paidPlan": "Plano pago",
    "dashboard.aiTools": "Ferramentas de IA",

    "usage.title": "Uso das ferramentas hoje",
    "usage.plan": "plano {plan}",
    "usage.used": "{used} de {limit} operações usadas",
    "usage.limitReached": "Limite atingido — {used} de {limit} operações usadas",
    "usage.upgrade": "Faça upgrade para um limite diário maior →",

    "settings.title": "Configurações",
    "settings.profile": "Perfil",
    "settings.theme": "Tema",
    "settings.notifications": "Notificações",
    "settings.password": "Senha",
    "settings.language": "Idioma",
    "settings.billing": "Assinatura e faturamento",
    "settings.team": "Equipe",
    "settings.interfaceLanguage": "Idioma da interface",
    "settings.searchLanguages": "Pesquisar idiomas...",

    "tools.allTools": "Todas as ferramentas",
    "tools.available": "{count} ferramentas disponíveis",
    "tools.availableOne": "1 ferramenta disponível",
    "tools.search": "Pesquisar ferramentas...",
    "tools.noMatch": "Nenhuma ferramenta corresponde a",
    "tools.heading": "Todas as ferramentas PDF",
    "tools.subtitle": "Converta, edite, comprima, organize e proteja seus PDFs em um só lugar.",
    "tools.badge": "Kit de PDF",
    "common.cancel": "Cancelar",
    "common.save": "Salvar",
    "common.delete": "Excluir",
    "common.download": "Baixar",
    "common.close": "Fechar",
    "common.loading": "Carregando...",
};

const ar: Partial<typeof en> = {
    "nav.dashboard": "لوحة التحكم",
    "nav.tools": "الأدوات",
    "nav.settings": "الإعدادات",
    "nav.logout": "تسجيل الخروج",
    "nav.upgradeTitle": "الترقية إلى Pro",
    "nav.upgradeBody": "أدوات غير محدودة والمزيد.",
    "nav.upgradeCta": "الترقية الآن",

    "dashboard.welcome": "مرحبًا بعودتك",
    "dashboard.subtitle": "خطتك وجميع الأدوات في مكان واحد.",
    "dashboard.quickActions": "إجراءات سريعة",
    "dashboard.freePlan": "الخطة المجانية",
    "dashboard.paidPlan": "الخطة المدفوعة",
    "dashboard.aiTools": "أدوات الذكاء الاصطناعي",

    "usage.title": "استخدام الأدوات اليوم",
    "usage.plan": "خطة {plan}",
    "usage.used": "{used} من {limit} عملية مستخدمة",
    "usage.limitReached": "تم بلوغ الحد — {used} من {limit} عملية مستخدمة",
    "usage.upgrade": "الترقية للحصول على حد يومي أعلى →",

    "settings.title": "الإعدادات",
    "settings.profile": "الملف الشخصي",
    "settings.theme": "المظهر",
    "settings.notifications": "الإشعارات",
    "settings.password": "كلمة المرور",
    "settings.language": "اللغة",
    "settings.billing": "الاشتراك والفوترة",
    "settings.team": "الفريق",
    "settings.interfaceLanguage": "لغة الواجهة",
    "settings.searchLanguages": "ابحث عن لغة...",

    "tools.allTools": "كل الأدوات",
    "tools.available": "{count} أدوات متاحة",
    "tools.availableOne": "أداة واحدة متاحة",
    "tools.search": "ابحث عن أداة...",
    "tools.noMatch": "لا توجد أدوات مطابقة",
    "tools.heading": "كل أدوات PDF",
    "tools.subtitle": "حوّل وحرّر واضغط ونظّم وأمّن ملفات PDF في مكان واحد.",
    "tools.badge": "حزمة أدوات PDF",
    "common.cancel": "إلغاء",
    "common.save": "حفظ",
    "common.delete": "حذف",
    "common.download": "تنزيل",
    "common.close": "إغلاق",
    "common.loading": "جارٍ التحميل...",
};

const ur: Partial<typeof en> = {
    "nav.dashboard": "ڈیش بورڈ",
    "nav.tools": "ٹولز",
    "nav.settings": "ترتیبات",
    "nav.logout": "لاگ آؤٹ",
    "nav.upgradeTitle": "پرو میں اپ گریڈ کریں",
    "nav.upgradeBody": "لامحدود ٹولز اور مزید۔",
    "nav.upgradeCta": "ابھی اپ گریڈ کریں",

    "dashboard.welcome": "خوش آمدید",
    "dashboard.subtitle": "آپ کا پلان اور تمام ٹولز، ایک ہی جگہ۔",
    "dashboard.quickActions": "فوری اقدامات",
    "dashboard.freePlan": "مفت پلان",
    "dashboard.paidPlan": "ادا شدہ پلان",
    "dashboard.aiTools": "AI ٹولز",

    "usage.title": "آج ٹولز کا استعمال",
    "usage.plan": "{plan} پلان",
    "usage.used": "{limit} میں سے {used} کارروائیاں استعمال ہوئیں",
    "usage.limitReached": "حد مکمل — {limit} میں سے {used} کارروائیاں استعمال ہوئیں",
    "usage.upgrade": "زیادہ روزانہ حد کے لیے اپ گریڈ کریں ←",

    "settings.title": "ترتیبات",
    "settings.profile": "پروفائل",
    "settings.theme": "تھیم",
    "settings.notifications": "اطلاعات",
    "settings.password": "پاس ورڈ",
    "settings.language": "زبان",
    "settings.billing": "سبسکرپشن اور بلنگ",
    "settings.team": "ٹیم",
    "settings.interfaceLanguage": "انٹرفیس کی زبان",
    "settings.searchLanguages": "زبانیں تلاش کریں...",

    "tools.allTools": "تمام ٹولز",
    "tools.available": "{count} ٹولز دستیاب",
    "tools.availableOne": "1 ٹول دستیاب",
    "tools.search": "ٹولز تلاش کریں...",
    "tools.noMatch": "کوئی ٹول نہیں ملا",
    "tools.heading": "تمام PDF ٹولز",
    "tools.subtitle": "ایک ہی جگہ پر PDF فائلیں تبدیل، ترمیم، کمپریس، ترتیب اور محفوظ کریں۔",
    "tools.badge": "PDF ٹول کٹ",
    "common.cancel": "منسوخ",
    "common.save": "محفوظ کریں",
    "common.delete": "حذف کریں",
    "common.download": "ڈاؤن لوڈ",
    "common.close": "بند کریں",
    "common.loading": "لوڈ ہو رہا ہے...",
};

const zh: Partial<typeof en> = {
    "nav.dashboard": "仪表板",
    "nav.tools": "工具",
    "nav.settings": "设置",
    "nav.logout": "退出登录",
    "nav.upgradeTitle": "升级到 Pro",
    "nav.upgradeBody": "解锁无限工具及更多功能。",
    "nav.upgradeCta": "立即升级",

    "dashboard.welcome": "欢迎回来",
    "dashboard.subtitle": "您的方案与全部工具，尽在一处。",
    "dashboard.quickActions": "快捷操作",
    "dashboard.freePlan": "免费方案",
    "dashboard.paidPlan": "付费方案",
    "dashboard.aiTools": "AI 工具",

    "usage.title": "今日工具用量",
    "usage.plan": "{plan} 方案",
    "usage.used": "已使用 {limit} 次中的 {used} 次",
    "usage.limitReached": "已达上限 — 已使用 {limit} 次中的 {used} 次",
    "usage.upgrade": "升级以获得更高的每日额度 →",

    "settings.title": "设置",
    "settings.profile": "个人资料",
    "settings.theme": "主题",
    "settings.notifications": "通知",
    "settings.password": "密码",
    "settings.language": "语言",
    "settings.billing": "订阅与账单",
    "settings.team": "团队",
    "settings.interfaceLanguage": "界面语言",
    "settings.searchLanguages": "搜索语言...",

    "tools.allTools": "全部工具",
    "tools.available": "{count} 个工具可用",
    "tools.availableOne": "1 个工具可用",
    "tools.search": "搜索工具...",
    "tools.noMatch": "没有匹配的工具",
    "tools.heading": "全部 PDF 工具",
    "tools.subtitle": "在一个地方转换、编辑、压缩、整理并保护您的 PDF 文件。",
    "tools.badge": "PDF 工具箱",
    "common.cancel": "取消",
    "common.save": "保存",
    "common.delete": "删除",
    "common.download": "下载",
    "common.close": "关闭",
    "common.loading": "加载中...",
};

export const MESSAGES = { en, es, fr, de, pt, ar, ur, zh };

/** Every key the UI can ask for; English defines the set. */
export type MessageKey = keyof typeof en;

/** Locales with a catalogue. */
export type Locale = keyof typeof MESSAGES;

export const TRANSLATED_LOCALES = Object.keys(MESSAGES) as Locale[];

/**
 * What the settings dropdown offers. Native names as well as English ones,
 * since someone looking for their own language looks for its own name.
 */
export const SUPPORTED_LANGUAGES: { code: Locale; name: string; nativeName: string }[] = [
    { code: "en", name: "English", nativeName: "English" },
    { code: "es", name: "Spanish", nativeName: "Español" },
    { code: "fr", name: "French", nativeName: "Français" },
    { code: "de", name: "German", nativeName: "Deutsch" },
    { code: "pt", name: "Portuguese", nativeName: "Português" },
    { code: "ar", name: "Arabic", nativeName: "العربية" },
    { code: "ur", name: "Urdu", nativeName: "اردو" },
    { code: "zh", name: "Chinese", nativeName: "中文" },
];

/** Written right-to-left, so the document direction has to follow the choice. */
export const RTL_LOCALES = new Set(["ar", "he", "fa", "ur"]);
