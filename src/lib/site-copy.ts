export type Locale = 'en' | 'ar'

type SiteCopy = {
  navigationLabel: string
  navigation: {
    overview: string
    performance: string
    design: string
    engineering: string
    specifications: string
  }
  switchToArabic: string
  switchToEnglish: string
  driveInformation: string
  vehicleOptions: string
  studioLighting: string
  locationScene: string
  viewCockpit: string
  orbitView: string
  laserlights: string
  on: string
  off: string
  themeApex: string
  themeMTrack: string
  themeNight: string
  wheelFinishTitle: string
  brakeCaliperTitle: string
  resetBuild: string
  heroEyebrow: string
  heroTitle: string
  heroDescription: string
  heroAction: string
  heroSpecs: string[]
  modelCredit: string
  frontEyebrow: string
  frontTitle: string
  frontDescription: string
  rearEyebrow: string
  rearTitle: string
  rearDescription: string
  engineeringEyebrow: string
  engineeringStatus: string
  engineeringTitle: string
  engineeringDescription: string
  closingEyebrow: string
  closingTitle: string
  shareBuild: string
  buildLinkCopied: string
  buildLinkReady: string
  loadingExperience: string
  stillLoading: string
  loadingModel: string
  modelUnavailable: string
  retryLoading: string
  fallbackTitle: string
  fallbackDescription: string
  enableWebGL: string
  experienceErrorTitle: string
  experienceErrorDescription: string
  technicalDetails: string
  retry: string
  driveEyebrow: string
  driveTitle: string
  driveDescription: string
  paint: string
  wheels: string
  brakes: string
  location: string
  backToExperience: string
  copyBuildLink: string
  closeDriveInformation: string
  cockpit: string
  driverSeat: string
  cockpitHint: string
  exitCockpit: string
}

export const SITE_COPY: Record<Locale, SiteCopy> = {
  en: {
    navigationLabel: 'Experience navigation',
    navigation: {
      overview: 'Overview',
      performance: 'Performance',
      design: 'Design',
      engineering: 'Engineering',
      specifications: 'Specifications',
    },
    switchToArabic: 'Switch to Arabic',
    switchToEnglish: 'Switch to English',
    driveInformation: 'Drive information',
    vehicleOptions: 'Vehicle options',
    studioLighting: 'Studio lighting',
    locationScene: 'Location',
    viewCockpit: 'Cockpit view',
    orbitView: '360° view',
    laserlights: 'Laserlights',
    on: 'On',
    off: 'Off',
    themeApex: 'Studio',
    themeMTrack: 'M colours',
    themeNight: 'Night',
    wheelFinishTitle: '20” Style 863M wheel finish',
    brakeCaliperTitle: 'M Carbon Ceramic brake caliper colour',
    resetBuild: 'Reset configuration',
    heroEyebrow: 'BMW M5 CS · F90',
    heroTitle: 'The M5 CS.',
    heroDescription: '627 hp. 70 kg lighter. A focused expression of the M5, developed for road and track.',
    heroAction: 'Configure your build',
    heroSpecs: ['627 hp', '750 Nm', '3.0 s · 0–100 km/h'],
    modelCredit: '3D model: BMW M5 CS (F90) by fvrenbld · CC BY 4.0',
    frontEyebrow: '01 — Front',
    frontTitle: 'A sharper front end',
    frontDescription: 'M Laserlights, a wider kidney grille and a carbon-fibre splitter.',
    rearEyebrow: '02 — Rear',
    rearTitle: 'Track-bred details',
    rearDescription: 'Darkened tail lamps, a carbon diffuser and four exhaust outlets.',
    engineeringEyebrow: '03 — Engineering',
    engineeringStatus: 'Powertrain',
    engineeringTitle: 'S63 V8 · lightweight construction',
    engineeringDescription: 'A closer look at the drivetrain and the details that reduce weight.',
    closingEyebrow: 'BMW M5 CS',
    closingTitle: 'Focused power. Nothing extra.',
    shareBuild: 'Share build',
    buildLinkCopied: 'Build link copied',
    buildLinkReady: 'Build link ready',
    loadingExperience: 'Loading the M5 CS experience',
    stillLoading: 'Still loading…',
    loadingModel: 'Preparing the vehicle',
    modelUnavailable: 'The 3D model could not load',
    retryLoading: 'Try again',
    fallbackTitle: '3D showcase unavailable',
    fallbackDescription: 'The interactive studio needs WebGL to render the car.',
    enableWebGL: 'Enable hardware acceleration in your browser settings, then reload.',
    experienceErrorTitle: 'The studio has stopped',
    experienceErrorDescription: 'The interactive experience could not finish loading. Reload to try again.',
    technicalDetails: 'Technical details',
    retry: 'Reload experience',
    driveEyebrow: 'Vehicle information',
    driveTitle: 'Take your build to a BMW retailer.',
    driveDescription: 'This is an unofficial concept experience. Drive requests are not connected to BMW or a dealer, and this page does not collect personal information. Contact your local BMW retailer to ask about availability.',
    paint: 'Paint',
    wheels: 'Wheels',
    brakes: 'Brakes',
    location: 'Location',
    backToExperience: 'Back to experience',
    copyBuildLink: 'Copy this build link',
    closeDriveInformation: 'Close vehicle information',
    cockpit: 'Cockpit',
    driverSeat: 'Driver’s seat',
    cockpitHint: 'Drag to look around.',
    exitCockpit: 'Exit cockpit',
  },
  ar: {
    navigationLabel: 'التنقّل في التجربة',
    navigation: {
      overview: 'نظرة عامة',
      performance: 'الأداء',
      design: 'التصميم',
      engineering: 'الهندسة',
      specifications: 'المواصفات',
    },
    switchToArabic: 'التبديل إلى العربية',
    switchToEnglish: 'التبديل إلى الإنجليزية',
    driveInformation: 'معلومات السيارة',
    vehicleOptions: 'إعدادات السيارة',
    studioLighting: 'إضاءة الاستوديو',
    locationScene: 'الموقع',
    viewCockpit: 'منظور المقصورة',
    orbitView: 'منظور 360°',
    laserlights: 'مصابيح الليزر',
    on: 'تشغيل',
    off: 'إيقاف',
    themeApex: 'الاستوديو',
    themeMTrack: 'ألوان M',
    themeNight: 'ليلي',
    wheelFinishTitle: 'تشطيب جنوط Style 863M قياس 20 بوصة',
    brakeCaliperTitle: 'لون مكابح M الكربونية السيراميكية',
    resetBuild: 'إعادة الإعداد الافتراضي',
    heroEyebrow: 'BMW M5 CS · F90',
    heroTitle: 'BMW M5 CS.',
    heroDescription: 'بقوة 627 حصاناً ووزن أقل بـ70 كغ؛ نسخة أكثر تركيزاً من M5، للطرق والحلبات.',
    heroAction: 'خصّص سيارتك',
    heroSpecs: ['627 حصاناً', '750 نيوتن متر', '3.0 ث · 0–100 كم/س'],
    modelCredit: 'النموذج ثلاثي الأبعاد: BMW M5 CS (F90) من fvrenbld · CC BY 4.0',
    frontEyebrow: '01 — الواجهة',
    frontTitle: 'مقدمة أكثر حدّة',
    frontDescription: 'مصابيح M Laserlight، وشبك كلوي أعرض، ومشتّت هواء من ألياف الكربون.',
    rearEyebrow: '02 — المؤخرة',
    rearTitle: 'تفاصيل مستوحاة من الحلبة',
    rearDescription: 'مصابيح خلفية داكنة، ومشتّت كربوني، وأربعة مخارج للعادم.',
    engineeringEyebrow: '03 — الهندسة',
    engineeringStatus: 'منظومة الحركة',
    engineeringTitle: 'محرك S63 V8 · بنية خفيفة الوزن',
    engineeringDescription: 'نظرة أقرب إلى مجموعة الحركة والتفاصيل التي تخفّض الوزن.',
    closingEyebrow: 'BMW M5 CS',
    closingTitle: 'قوة مركّزة. لا شيء زائد.',
    shareBuild: 'مشاركة الإعداد',
    buildLinkCopied: 'تم نسخ رابط الإعداد',
    buildLinkReady: 'رابط الإعداد جاهز',
    loadingExperience: 'جارٍ تحميل تجربة M5 CS',
    stillLoading: 'ما زال التحميل جارياً…',
    loadingModel: 'جارٍ تجهيز السيارة',
    modelUnavailable: 'تعذّر تحميل النموذج ثلاثي الأبعاد',
    retryLoading: 'إعادة المحاولة',
    fallbackTitle: 'العرض ثلاثي الأبعاد غير متاح',
    fallbackDescription: 'يتطلب المعرض التفاعلي دعم WebGL لعرض السيارة.',
    enableWebGL: 'فعّل تسريع الأجهزة من إعدادات المتصفح، ثم أعد تحميل الصفحة.',
    experienceErrorTitle: 'توقفت التجربة',
    experienceErrorDescription: 'تعذّر تحميل التجربة التفاعلية بالكامل. أعد تحميل الصفحة للمحاولة مرة أخرى.',
    technicalDetails: 'تفاصيل تقنية',
    retry: 'إعادة تحميل التجربة',
    driveEyebrow: 'معلومات السيارة',
    driveTitle: 'استفسر عن سيارتك لدى وكيل BMW.',
    driveDescription: 'هذه تجربة تصورية غير رسمية. لا ترتبط طلبات القيادة بشركة BMW أو بأي وكيل، ولا تجمع هذه الصفحة بيانات شخصية. تواصل مع وكيل BMW المحلي للاستفسار عن التوفر.',
    paint: 'الطلاء',
    wheels: 'الجنوط',
    brakes: 'المكابح',
    location: 'الموقع',
    backToExperience: 'العودة إلى التجربة',
    copyBuildLink: 'نسخ رابط الإعداد',
    closeDriveInformation: 'إغلاق معلومات السيارة',
    cockpit: 'المقصورة',
    driverSeat: 'مقعد السائق',
    cockpitHint: 'اسحب لاستكشاف المقصورة.',
    exitCockpit: 'الخروج من المقصورة',
  },
}

export function getSiteCopy(locale: Locale): SiteCopy {
  return SITE_COPY[locale]
}
