export type PublicUseCasePage = {
  slug: string
  eyebrow: string
  title: string
  h1: string
  description: string
  image: string
  imageAlt: string
  audience: string
  outcomes: string[]
  workflow: string[]
  examples: string[]
  keywords: string[]
}

export const useCasePages: PublicUseCasePage[] = [
  {
    slug: 'ai-photo-editor',
    eyebrow: 'AI Photo Editor',
    title: 'AI Photo Editor by Chat',
    h1: 'Edit photos by telling Makaron what you want',
    description:
      'Makaron is an AI photo editor that lets creators retouch, restyle, clean up, and transform images through natural conversation.',
    image: '/landing/tips.jpg',
    imageAlt: 'Makaron AI photo editor showing visual suggestions for a photo',
    audience: 'For creators who want fast, high-quality edits without learning complex editing software.',
    outcomes: [
      'Retouch portraits while keeping the original face recognizable.',
      'Try multiple creative directions before committing to one edit.',
      'Keep every generated version in a visual timeline for comparison.',
    ],
    workflow: [
      'Upload a photo to Makaron.',
      'Ask for the edit in plain language.',
      'Preview AI suggestions and continue refining by chat.',
    ],
    examples: [
      'Make this portrait feel cinematic but keep my face natural.',
      'Clean up the background and make the product stand out.',
      'Give this travel photo warmer light and richer depth.',
    ],
    keywords: ['AI photo editor', 'AI retouching', 'photo editing by chat'],
  },
  {
    slug: 'photo-to-video',
    eyebrow: 'Photo to Video',
    title: 'AI Photo to Video Maker',
    h1: 'Turn still photos into short cinematic videos',
    description:
      'Use Makaron to turn images into AI videos with camera motion, scene direction, and story prompts controlled through chat.',
    image: '/landing/video.jpg',
    imageAlt: 'Makaron video creation interface for turning photos into motion',
    audience: 'For solo creators, founders, and social teams who need short visual stories from existing images.',
    outcomes: [
      'Animate product shots, portraits, and campaign images.',
      'Generate short clips for social posts, ads, or launch teasers.',
      'Add direction like camera movement, atmosphere, and pacing.',
    ],
    workflow: [
      'Upload one or more images.',
      'Describe the scene and movement you want.',
      'Generate a short video and keep it in the project timeline.',
    ],
    examples: [
      'Turn this product photo into a 5 second launch teaser.',
      'Make the camera slowly push in with warm cinematic light.',
      'Create a vlog-style clip from these travel photos.',
    ],
    keywords: ['AI photo to video', 'image to video AI', 'AI video maker'],
  },
  {
    slug: 'product-photos',
    eyebrow: 'Product Content',
    title: 'AI Product Photo Generator',
    h1: 'Create product photos and campaign visuals from one shot',
    description:
      'Makaron helps small teams turn a single product photo into polished ecommerce images, posters, and social media variants.',
    image: '/landing/uc-explore.jpg',
    imageAlt: 'Makaron product content examples generated from an image',
    audience: 'For founders and operators who need product content without a full creative team.',
    outcomes: [
      'Generate ecommerce-style hero images from rough product shots.',
      'Explore multiple campaign directions from the same source image.',
      'Create platform-ready visuals for launches and social posts.',
    ],
    workflow: [
      'Upload a product image.',
      'Ask Makaron for a campaign direction or specific format.',
      'Iterate until the image matches your brand and channel.',
    ],
    examples: [
      'Make this product photo look like a premium ecommerce hero shot.',
      'Create three different social campaign directions.',
      'Turn this object into a clean poster with strong lighting.',
    ],
    keywords: ['AI product photo generator', 'AI ecommerce photos', 'product photo editor'],
  },
  {
    slug: 'ai-poster-generator',
    eyebrow: 'Posters',
    title: 'AI Poster Generator',
    h1: 'Make posters, covers, and campaign images with an AI agent',
    description:
      'Makaron turns images and prompts into poster-style visuals for launches, events, fan content, and social campaigns.',
    image: '/landing/agent.jpg',
    imageAlt: 'Makaron AI agent creating poster-style visual content',
    audience: 'For one-person studios that need polished visual concepts quickly.',
    outcomes: [
      'Create poster concepts from a portrait, product, or rough idea.',
      'Use chat to refine composition, mood, styling, and text direction.',
      'Generate variants without restarting the creative process.',
    ],
    workflow: [
      'Start with an image or a written idea.',
      'Ask Makaron for a poster direction.',
      'Refine the image and export the version that works.',
    ],
    examples: [
      'Turn this portrait into a cinematic movie poster.',
      'Make a launch poster for this product photo.',
      'Create a bold social cover image from this idea.',
    ],
    keywords: ['AI poster generator', 'AI campaign images', 'AI cover maker'],
  },
  {
    slug: 'pet-stickers',
    eyebrow: 'Stickers',
    title: 'AI Pet Sticker Maker',
    h1: 'Turn pet photos into stickers, reactions, and character moments',
    description:
      'Makaron can transform pet photos into expressive stickers and playful visual content while preserving the original personality.',
    image: '/landing/uc-retouch.jpg',
    imageAlt: 'Makaron creative image editing examples for playful photo transformations',
    audience: 'For creators who want fun, shareable image sets from everyday photos.',
    outcomes: [
      'Create sticker-like cutouts and expressive variants.',
      'Generate themed scenes from a single pet photo.',
      'Keep the subject recognizable across multiple styles.',
    ],
    workflow: [
      'Upload a pet photo.',
      'Pick a sticker, reaction, or character concept.',
      'Generate and refine a set of shareable images.',
    ],
    examples: [
      'Make my cat into a cute sticker pack.',
      'Give my dog matching sunglasses and a playful pose.',
      'Turn this pet photo into expressive chat reactions.',
    ],
    keywords: ['AI pet sticker maker', 'AI sticker generator', 'pet photo editor'],
  },
  {
    slug: 'social-content',
    eyebrow: 'Social Content',
    title: 'AI Social Media Content Generator',
    h1: 'Create social-ready images and videos from your existing photos',
    description:
      'Makaron helps creators turn raw photos into social posts, short videos, campaign images, and visual storyboards.',
    image: '/landing/uc-storyboard.jpg',
    imageAlt: 'Makaron storyboard and social content workflow',
    audience: 'For people running content, campaigns, or personal brands without a large creative team.',
    outcomes: [
      'Turn one image into multiple content directions.',
      'Create short video ideas and storyboards from photo sets.',
      'Move from idea to shareable visual without switching tools.',
    ],
    workflow: [
      'Upload images from your camera roll or product library.',
      'Ask Makaron for a social post, storyboard, or short video.',
      'Refine the results in chat and save the best version.',
    ],
    examples: [
      'Make a set of social media visuals from this product shot.',
      'Turn these photos into a short vlog with music.',
      'Give me six different creative directions for this image.',
    ],
    keywords: ['AI social media content generator', 'AI visual content', 'AI storyboard maker'],
  },
]

export function getUseCasePage(slug: string) {
  return useCasePages.find((page) => page.slug === slug)
}
