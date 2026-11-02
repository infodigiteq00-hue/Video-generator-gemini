// The offer on the landing page and in the signup funnel. Everything here is shown to customers as it is, so keep it true.

export interface Testimonial {
  name: string;
  business: string;
  quote: string;
  /** 1 to 5 */
  rating: number;
}

export const OFFER = {
  pack: 'Diwali Pack',
  price: 999,
  regularPrice: 2999,
  /** The launch price ends at the end of this day; after it the regular price applies. */
  launchEnds: '2026-11-05',
  /** Founding customers at the launch price. The counter shows the real number of paid accounts once it reaches `showTakenFrom`. */
  seats: 100,
  showTakenFrom: 10,
  /** Indian mobile with country code, e.g. '919876543210'. Empty hides the WhatsApp buttons. */
  whatsapp: '919067610118',
  /** Our team's number for questions and help: shown on every screen as Call and WhatsApp. */
  support: '9067610118',
  /** Real quotes from customers. The reviews section stays hidden while this is empty. */
  testimonials: [] as Testimonial[],
};

export const launchOn = () => new Date() <= new Date(`${OFFER.launchEnds}T23:59:59`);
export const priceNow = () => (launchOn() ? OFFER.price : OFFER.regularPrice);
export const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
export const supportLabel = () => `+91 ${OFFER.support.slice(0, 5)} ${OFFER.support.slice(5)}`;
export const whatsappLink = (text: string) => (OFFER.whatsapp ? `https://wa.me/${OFFER.whatsapp}?text=${encodeURIComponent(text)}` : null);
