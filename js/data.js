// The work. Order is the order they tile across the canvas.
// Supports both photos (.webp, .jpg, .jpeg, .png) and videos (.mp4, .webm).
export const WORKS = [
  // ── Photos & Videos from assets/tiles ──
  { src: './assets/tiles/-- বারান্দা-- ২৯ বৈশাখ,  ১৪৩৩.webp', label: 'বারান্দা · ২৯ বৈশাখ', type: 'photo' },
  { src: './assets/tiles/Organized chaos ¿.webp', label: 'Organized chaos', type: 'photo' },
  { src: './assets/tiles/“তুমি আসবে বলে তাই”.mp4', label: 'তুমি আসবে বলে তাই', type: 'video' },
  { src: './assets/tiles/তবু আ কা শ নী ল !.webp', label: 'তবু আকাশ নীল', type: 'photo' },
  { src: './assets/tiles/document_6077976432963755182.mp4', label: '', type: 'video' },
  { src: './assets/tiles/“হায় ভালোবাসি তবুও ”.webp', label: 'হায় ভালোবাসি তবুও', type: 'photo' },
  { src: './assets/tiles/Organized chaos ¿ (1).webp', label: 'Organized chaos II', type: 'photo' },
  { src: './assets/tiles/TALOBASHA.mp4', label: 'talobasha', type: 'video' },
  { src: './assets/tiles/ল্যাদ খেতে খেতে পোস্টালাম.webp', label: 'ল্যাদ', type: 'photo' },
  { src: './assets/tiles/document_6077976432963755191.mp4', label: '', type: 'video' },
  { src: './assets/tiles/WhatsApp Image 2026-08-26 at 2.11.39 PM.jpeg', label: 'talobasha', type: 'photo' },
  { src: './assets/tiles/document_6077976432963755194.mp4', label: '', type: 'video' },
  { src: './assets/tiles/এইনে তো যা মন চায় পোস্টাতাম ভুলে গেসিলাম তাই আবার পোস্টালাম.webp', label: 'যা মন চায়', type: 'photo' },
  { src: './assets/tiles/document_6095650558394245494.mp4', label: '', type: 'video' },
  { src: './assets/tiles/তবু আ কা শ নী ল ! (1).webp', label: 'তবু আকাশ নীল II', type: 'photo' },
  { src: './assets/tiles/document_6235278115531136432.mp4', label: '', type: 'video' },
  { src: './assets/tiles/“হায় ভালোবাসি তবুও ” (1).webp', label: 'হায় ভালোবাসি তবুও II', type: 'photo' },
  { src: './assets/tiles/document_6235278115531136433.mp4', label: '', type: 'video' },
  { src: './assets/tiles/ল্যাদ খেতে খেতে পোস্টালাম (1).webp', label: 'ল্যাদ II', type: 'photo' },
  { src: './assets/tiles/document_6235278115531136436.mp4', label: '', type: 'video' },
  { src: './assets/tiles/Organized chaos ¿ (2).webp', label: 'Organized chaos III', type: 'photo' },
  { src: './assets/tiles/document_6235278115531136444.mp4', label: '', type: 'video' },
  { src: './assets/tiles/photo_6330055395535164213_w.jpg', label: 'memories', type: 'photo' },
  { src: './assets/tiles/document_6309644576613211947.mp4', label: '', type: 'video' },
  { src: './assets/tiles/এইনে তো যা মন চায় পোস্টাতাম ভুলে গেসিলাম তাই আবার পোস্টালাম (1).webp', label: 'যা মন চায় II', type: 'photo' },
  { src: './assets/tiles/document_6309843059936862514.mp4', label: '', type: 'video' },
  { src: './assets/tiles/তবু আ কা শ নী ল ! (2).webp', label: 'তবু আকাশ নীল III', type: 'photo' },
  { src: './assets/tiles/document_6309843059936862517.mp4', label: '', type: 'video' },
  { src: './assets/tiles/ল্যাদ খেতে খেতে পোস্টালাম (2).webp', label: 'ল্যাদ III', type: 'photo' },
  { src: './assets/tiles/document_6336666410600638003.mp4', label: '', type: 'video' },
  { src: './assets/tiles/“হায় ভালোবাসি তবুও ” (2).webp', label: 'হায় ভালোবাসি তবুও III', type: 'photo' },
  { src: './assets/tiles/document_6336666410600638004.mp4', label: '', type: 'video' },
  { src: './assets/tiles/ল্যাদ খেতে খেতে পোস্টালাম (3).webp', label: 'ল্যাদ IV', type: 'photo' }
];

// Text cards live in the same grid as the films and are clickable.
export function getDaysCount(){
  const start = new Date('2026-01-31T00:00:00');
  const now = new Date();
  const diff = Math.max(0, now - start);
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  return `${days} days together`;
}

export const CARDS = [
  { text: 'about talobasha', route: 'about' },
  { text: getDaysCount(),    route: 'contact' }
];
