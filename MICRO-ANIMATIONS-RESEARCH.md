# Micro-Animations & Motion Design Research Report

> Research compiled from analysis of top AI/SaaS products (March 2025)
> For AskElira production implementation reference

---

## Table of Contents

1. [Product Analysis](#1-product-animation-analysis)
2. [Animation Categories & Patterns](#2-animation-categories--patterns)
3. [AI-Specific Animations](#3-ai-specific-animations)
4. [Timing & Easing Reference](#4-timing--easing-reference)
5. [Spring Physics Guide](#5-spring-physics-guide)
6. [Performance Guidelines](#6-performance-guidelines)
7. [Accessibility Requirements](#7-accessibility-requirements)
8. [Decision Framework: When to Animate](#8-decision-framework-when-to-animate)

---

## 1. Product Animation Analysis

### Linear (Project Management)

**Why it feels "buttery smooth":**
- Exclusively uses CSS `transform` and `opacity` animations, both GPU-accelerated
- Animations run on the compositor thread, not the main JS thread
- Custom easing curves with strong acceleration (not default `ease`)
- Very short durations: 150-200ms for most interactions

**Key patterns observed:**
- **Issue transitions**: Slide + fade, ~200ms, ease-out
- **Sidebar navigation**: Width + opacity transition, ~250ms, custom cubic-bezier
- **Status changes**: Color crossfade with subtle scale pulse, ~150ms
- **Keyboard shortcuts**: Instant response (<100ms) with subtle visual confirmation
- **Drag and drop**: Real-time transform tracking with spring settle

**Takeaway:** Linear proves that animation speed is the primary differentiator. Sub-200ms transitions with proper easing create the perception of a "fast" product.

---

### Vercel (Developer Platform)

**Key patterns observed:**
- **Direction-aware navigation**: Tab indicator follows mouse direction from previous to current position using Framer Motion `layoutId`
- **Deployment status**: Animated progress ring with color transitions (gray -> yellow -> green)
- **Log streaming**: Monospace text appears line-by-line with subtle fade-in, ~50ms stagger
- **Dashboard cards**: Hover lifts card 2-4px with shadow deepening, ~200ms ease-out
- **Page transitions**: Fade + slight Y-axis slide (8-12px), ~300ms

**Technical approach:**
- Heavy use of Framer Motion (now Motion) with `AnimatePresence` for enter/exit
- `layoutId` for shared element transitions across navigation
- Spring animations for interactive elements: `{ stiffness: 200, damping: 20 }`

---

### Stripe (Payments)

**Design philosophy:**
- Animations enrich the core payment experience -- not decorative, always functional
- Exclusively animates `transform` and `opacity` to maintain 60fps
- Prioritizes "perceived smoothness over feature-complete fidelity"
- Keeps main thread unburdened by offloading animation to GPU

**Key patterns observed:**
- **Payment form**: Input focus rings animate with `box-shadow` (via pseudo-element trick for performance)
- **Card number formatting**: Digits slide into groups with 100ms transitions
- **Success animation**: Checkmark draws via SVG stroke-dasharray animation, ~600ms with ease-in-out
- **Error states**: Subtle red border fade + gentle horizontal shake (3 cycles, 300ms total)
- **Documentation page**: Sidebar navigation highlights slide with `layoutId`, content fades in ~200ms
- **Gradient backgrounds**: WebGL-powered ambient color shifts on marketing pages

**Takeaway:** Stripe demonstrates that constraint breeds excellence. By limiting themselves to transform/opacity, they achieve consistently smooth animations across all devices.

---

### Raycast (Command Palette)

**Key patterns observed:**
- **Palette appearance**: Scale from 0.95 to 1.0 + opacity 0->1, ~150ms, spring-like ease-out
- **List item selection**: Background highlight slides between items with ~100ms transition
- **Result filtering**: Items exit with fade + slight Y offset, new items enter staggered (~30ms between items)
- **Extension panels**: Slide-in from right, ~250ms ease-out
- **Command execution**: Quick flash confirmation + palette dismissal ~200ms

**Technical approach:**
- Native macOS rendering (not web-based) allows for 120fps on ProMotion displays
- Spring-based animations with high stiffness for snappy feel
- No animation on the actual typing/search -- instant response to maintain speed perception

**Takeaway:** Command palettes require the fastest animations in all of UI. Anything over 150ms for appearance/disappearance feels sluggish. Selection transitions must be under 100ms.

---

### Notion (Productivity)

**Key patterns observed:**
- **Page transitions**: Fade + slide-up (~12px), 200-300ms, ease-out
- **Block manipulation**: Drag handles appear on hover with 150ms fade, blocks reorder with spring physics
- **Sidebar expand/collapse**: Width animation 250-300ms with content fade
- **Slash command menu**: Appears with scale 0.97->1.0 + opacity, ~150ms
- **Toggle blocks**: Height animation using `max-height` trick, ~250ms ease-in-out
- **Database views**: Tab switching with shared element border animation

**Technical note (performance):**
- Notion uses JS-driven animations (requestAnimationFrame), which are NOT hardware accelerated
- This is why Notion can occasionally feel janky on complex pages with many animated blocks
- A CSS-first or Motion library approach would improve this significantly

---

### ChatGPT (AI Chat)

**Key patterns observed:**
- **Message streaming**: Token-by-token appearance (typewriter style), ~5ms per character
- **Thinking indicator**: Three-dot bounce animation, each dot offset by 200ms, total cycle ~1200ms
- **"Deep thinking" mode**: Pulsing shimmer bar with indeterminate progress, ~2s cycle
- **New message entry**: Slide up from bottom + fade, ~300ms ease-out
- **Code blocks**: Syntax-highlighted text appears line-by-line with ~30ms stagger
- **Copy button feedback**: Checkmark replaces copy icon with 200ms crossfade
- **Sidebar conversations**: Slide-in from left on mobile, ~250ms ease-out

**Streaming text approach:**
- NOT a traditional typewriter animation -- tokens appear as they arrive from the API via SSE
- A consistent streaming pace of ~5ms per character (200 chars/second) feels readable and not too slow
- Blinking cursor at the end of streaming text indicates active generation
- Smooth auto-scroll follows content, with `scrollIntoView({ behavior: 'smooth' })`

---

### v0.dev (AI Code Generation)

**Key patterns observed:**
- **Code generation**: Lines appear sequentially with syntax highlighting, ~50ms per line stagger
- **Preview panel**: Generated UI fades in as components stream from server, ~300ms
- **Chat interface**: Similar to ChatGPT streaming with token-by-token display
- **Component preview toggle**: Slide transition between code and preview views, ~250ms
- **Iteration history**: Horizontal scroll with snap points

**Technical approach:**
- Uses Vercel AI SDK with React Server Components for streaming UI
- Components stream directly from LLMs without heavy client-side JS
- Framer Motion for UI transitions between states

---

## 2. Animation Categories & Patterns

### 2.1 Hover Effects

#### Button Hover (Scale + Shadow)
- **Description**: Button scales up slightly and shadow deepens, creating a "lift" effect
- **Duration**: 150-200ms
- **Easing**: `ease-out` or `cubic-bezier(0.25, 0.46, 0.45, 0.94)`
- **CSS approach**:
  ```css
  .button {
    transition: transform 150ms ease-out, box-shadow 150ms ease-out;
  }
  .button:hover {
    transform: translateY(-1px) scale(1.02);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
  .button:active {
    transform: translateY(0) scale(0.98);
    transition-duration: 100ms;
  }
  ```
- **Framer Motion approach**:
  ```jsx
  <motion.button
    whileHover={{ y: -1, scale: 1.02 }}
    whileTap={{ scale: 0.98 }}
    transition={{ type: "spring", stiffness: 400, damping: 17 }}
  />
  ```
- **Psychology**: The lift effect maps to physical affordance -- objects you can interact with "respond" to proximity. The :active press-down provides tactile feedback.

#### Card Hover (Lift + Glow + Border)
- **Description**: Card lifts 2-4px with enhanced shadow, optional subtle border glow
- **Duration**: 200ms
- **Easing**: `ease-out`
- **CSS approach**:
  ```css
  .card {
    transition: transform 200ms ease-out, box-shadow 200ms ease-out;
  }
  .card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1),
                0 0 0 1px rgba(99, 102, 241, 0.1);
  }
  ```
- **Psychology**: Elevation change signals interactivity. The shadow maps to real-world depth perception -- "this object is closer to me."

#### Link Hover (Underline + Color)
- **Description**: Underline slides in from left, color shifts
- **Duration**: 200ms
- **Easing**: `ease-in-out`
- **CSS approach**:
  ```css
  .link {
    position: relative;
    color: var(--text-secondary);
    transition: color 200ms ease;
  }
  .link::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    width: 0;
    height: 1px;
    background: currentColor;
    transition: width 200ms ease-in-out;
  }
  .link:hover { color: var(--text-primary); }
  .link:hover::after { width: 100%; }
  ```
- **Psychology**: Directional movement (left to right) follows reading direction, creating a sense of completion and invitation.

---

### 2.2 Loading States

#### Skeleton Screen with Shimmer
- **Description**: Gray placeholder shapes mimicking content layout, with a light gradient sweeping left-to-right
- **Duration**: 1.5-2s per cycle (infinite)
- **Easing**: `linear` (constant speed for the sweep)
- **CSS approach**:
  ```css
  .skeleton {
    background: #e2e8f0;
    border-radius: 4px;
    position: relative;
    overflow: hidden;
  }
  .skeleton::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(255, 255, 255, 0.4),
      transparent
    );
    animation: shimmer 1.5s infinite linear;
  }
  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
  ```
- **Pro tip**: Use `background-attachment: fixed` on the gradient to synchronize shimmer across multiple skeleton elements
- **Psychology**: The sweeping motion indicates "work in progress" -- the system is actively loading, not frozen. Shimmer reduces perceived wait time by 15-20% compared to static placeholders (per UX research).

#### Pulse Animation
- **Description**: Element gently pulses between two opacity values
- **Duration**: 1.5-2s per cycle
- **Easing**: `ease-in-out`
- **CSS approach**:
  ```css
  .pulse {
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  ```
- **Psychology**: Rhythmic pulsing mimics breathing, which is subconsciously calming and signals "alive but waiting."

#### Indeterminate Progress Bar
- **Description**: A colored bar that slides back and forth within a track
- **Duration**: 2-3s per cycle
- **Easing**: `cubic-bezier(0.65, 0, 0.35, 1)` (smooth acceleration/deceleration)
- **CSS approach**:
  ```css
  .progress-track {
    height: 3px;
    background: var(--surface-secondary);
    overflow: hidden;
    border-radius: 2px;
  }
  .progress-bar {
    height: 100%;
    width: 40%;
    background: var(--brand-primary);
    border-radius: 2px;
    animation: indeterminate 2s cubic-bezier(0.65, 0, 0.35, 1) infinite;
  }
  @keyframes indeterminate {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }
  ```
- **Psychology**: Continuous motion reassures users that the system is working. The acceleration curve prevents the monotonous feel of linear motion.

#### Spinner (Minimal)
- **Description**: Thin circular arc rotating continuously
- **Duration**: 0.8-1.2s per rotation
- **Easing**: `linear` for rotation, but the arc itself has ease via stroke-dasharray
- **CSS approach**:
  ```css
  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--surface-secondary);
    border-top-color: var(--brand-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  ```
- **Psychology**: Spinning is universally recognized as "processing." Thin, subtle spinners feel modern versus heavy, throbbing ones.

---

### 2.3 Page Transitions

#### Fade + Slide Up
- **Description**: New page content fades in while sliding up 8-16px from its final position
- **Duration**: 200-300ms (enter), 150-200ms (exit)
- **Easing**: Enter: `ease-out` | Exit: `ease-in`
- **Framer Motion approach**:
  ```jsx
  const pageVariants = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
  };

  <AnimatePresence mode="wait">
    <motion.div
      key={router.pathname}
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
    />
  </AnimatePresence>
  ```
- **Important**: Exit should be faster than enter (asymmetric timing). Enter ~300ms, exit ~200ms.
- **Psychology**: Upward motion implies "new content arriving" and maps to natural scroll direction. The asymmetry (slower enter, faster exit) ensures old content leaves quickly while new content settles in gently.

#### Shared Element Transition
- **Description**: An element (e.g., card, tab indicator) morphs its position/size between two states
- **Duration**: 250-350ms
- **Easing**: Spring (`stiffness: 300, damping: 30`)
- **Framer Motion approach**:
  ```jsx
  // Tab indicator that slides between active tabs
  {tabs.map(tab => (
    <button key={tab.id} onClick={() => setActive(tab.id)}>
      {tab.label}
      {active === tab.id && (
        <motion.div
          layoutId="activeTab"
          className="tab-indicator"
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        />
      )}
    </button>
  ))}
  ```
- **Psychology**: Object permanence -- the brain tracks the element as "the same thing" moving, rather than two separate elements appearing/disappearing. Dramatically reduces cognitive load during navigation.

#### Scale Transition (Modal/Dialog)
- **Description**: Modal scales from 0.95 to 1.0 with fade, backdrop fades in
- **Duration**: Modal: 200ms enter / 150ms exit | Backdrop: 200ms
- **Easing**: Enter: `ease-out` | Exit: `ease-in`
- **CSS approach**:
  ```css
  .modal-backdrop {
    opacity: 0;
    transition: opacity 200ms ease;
  }
  .modal-backdrop.open { opacity: 1; }

  .modal {
    opacity: 0;
    transform: scale(0.95);
    transition: opacity 200ms ease-out, transform 200ms ease-out;
  }
  .modal.open {
    opacity: 1;
    transform: scale(1);
  }
  ```
- **Psychology**: The slight scale-up mimics something "approaching" the user, demanding attention. Starting at 0.95 (not 0.5 or 0) keeps it subtle and non-jarring.

---

### 2.4 Scroll Animations

#### Fade-In on Scroll (Reveal)
- **Description**: Elements fade in (optionally with slight Y translation) as they enter the viewport
- **Duration**: 300-500ms
- **Easing**: `ease-out`
- **Implementation approach**:
  ```jsx
  // Using Intersection Observer + CSS
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target); // Only animate once
        }
      });
    },
    { threshold: 0.15 }
  );

  // CSS
  .reveal-item {
    opacity: 0;
    transform: translateY(20px);
    transition: opacity 400ms ease-out, transform 400ms ease-out;
  }
  .reveal-item.revealed {
    opacity: 1;
    transform: translateY(0);
  }
  ```
- **Stagger**: For lists, add `transition-delay: calc(var(--index) * 80ms)` for sequential reveal
- **Threshold**: 0.1-0.3 (trigger when 10-30% visible) -- higher threshold means element is more "in view" before animating
- **Psychology**: Progressive disclosure focuses attention on what's currently visible. Staggered reveals create rhythm and visual hierarchy.

#### Sticky Header Shrink
- **Description**: Header reduces height and shadow increases on scroll
- **Duration**: 200ms
- **Easing**: `ease-out`
- **Implementation**: Track scroll position, toggle class at threshold (e.g., 64px)
  ```css
  .header {
    height: 64px;
    box-shadow: none;
    transition: height 200ms ease-out,
                box-shadow 200ms ease-out,
                background-color 200ms ease-out;
  }
  .header.scrolled {
    height: 48px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    background-color: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(8px);
  }
  ```
- **Psychology**: The header "getting out of the way" respects the user's current task (reading content) while remaining accessible.

---

### 2.5 Feedback Animations

#### Success Checkmark
- **Description**: Circle draws, then checkmark draws inside with a slight delay
- **Duration**: 500-700ms total (circle: 300ms, checkmark: 300ms with 100ms delay)
- **Easing**: `ease-in-out` for the stroke drawing
- **CSS approach (SVG)**:
  ```css
  .checkmark-circle {
    stroke-dasharray: 166;
    stroke-dashoffset: 166;
    animation: stroke 300ms ease-in-out forwards;
  }
  .checkmark-check {
    stroke-dasharray: 48;
    stroke-dashoffset: 48;
    animation: stroke 300ms ease-in-out 150ms forwards;
  }
  @keyframes stroke {
    to { stroke-dashoffset: 0; }
  }
  ```
- **Psychology**: The drawing motion creates a sense of "completion" -- the check is being "written" in real-time. The sequential reveal (circle then check) builds anticipation and satisfaction.

#### Error Shake
- **Description**: Element shakes horizontally 2-3 times with decreasing amplitude
- **Duration**: 300-400ms total
- **Easing**: `cubic-bezier(0.36, 0.07, 0.19, 0.97)` (sharp, not bouncy)
- **CSS approach**:
  ```css
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    10%, 50%, 90% { transform: translateX(-4px); }
    30%, 70% { transform: translateX(4px); }
  }
  .error-shake {
    animation: shake 400ms cubic-bezier(0.36, 0.07, 0.19, 0.97);
  }
  ```
- **Psychology**: Horizontal shaking universally signals "no" or "wrong" -- it maps to the head-shaking gesture. Decreasing amplitude makes it feel like natural settling.

#### Toast Notification
- **Description**: Slides in from edge (usually top-right or bottom-center) with fade
- **Duration**: Enter: 300ms | Exit: 200ms | Auto-dismiss: 3-5 seconds
- **Easing**: Enter: `cubic-bezier(0.21, 1.02, 0.73, 1)` (slight overshoot) | Exit: `ease-in`
- **CSS approach**:
  ```css
  .toast {
    transform: translateY(-100%) scale(0.95);
    opacity: 0;
    transition: transform 300ms cubic-bezier(0.21, 1.02, 0.73, 1),
                opacity 300ms ease-out;
  }
  .toast.visible {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
  .toast.exiting {
    transform: translateY(-50%) scale(0.95);
    opacity: 0;
    transition-duration: 200ms;
    transition-timing-function: ease-in;
  }
  ```
- **Accessibility**: Use `role="alert"` or `aria-live="polite"` for screen reader announcements
- **Psychology**: Slide-in captures peripheral attention without being disruptive. Auto-dismiss respects that the information is transient.

---

### 2.6 Navigation Animations

#### Sidebar Expand/Collapse
- **Description**: Sidebar width transitions with content opacity animation
- **Duration**: 250-300ms
- **Easing**: `ease-in-out` or spring (`stiffness: 200, damping: 25`)
- **Framer Motion approach**:
  ```jsx
  <motion.aside
    animate={{ width: isOpen ? 260 : 60 }}
    transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
  >
    <motion.div
      animate={{ opacity: isOpen ? 1 : 0 }}
      transition={{ duration: isOpen ? 0.2 : 0.1, delay: isOpen ? 0.15 : 0 }}
    >
      {/* sidebar labels */}
    </motion.div>
  </motion.aside>
  ```
- **Important**: Animate width via `transform: scaleX()` for performance, or use `layout` prop in Framer Motion. Direct width animation triggers layout recalculation.
- **Psychology**: Collapsing to icons preserves spatial memory ("I know where things are") while reclaiming screen space.

#### Tab Switching
- **Description**: Active indicator slides between tabs, content crossfades
- **Duration**: Indicator: 200-250ms | Content: 150ms
- **Easing**: Spring for indicator, ease for content
- **Psychology**: The sliding indicator provides spatial continuity -- users understand tab position relative to each other.

#### Dropdown Menu
- **Description**: Menu scales from 0.95 to 1.0 with fade, origin from trigger button
- **Duration**: Open: 150-200ms | Close: 100-150ms
- **Easing**: Open: `ease-out` | Close: `ease-in`
- **CSS approach**:
  ```css
  .dropdown {
    transform-origin: top left; /* or top right, based on trigger position */
    opacity: 0;
    transform: scale(0.95) translateY(-4px);
    transition: opacity 150ms ease-out, transform 150ms ease-out;
    pointer-events: none;
  }
  .dropdown.open {
    opacity: 1;
    transform: scale(1) translateY(0);
    pointer-events: auto;
  }
  ```
- **Psychology**: Scale + directional movement from the trigger creates a visual connection between the button and the menu. The `transform-origin` is critical -- it should match the trigger's position.

---

### 2.7 Data Transitions

#### Number Count-Up
- **Description**: Numeric values animate from 0 (or previous value) to the target number
- **Duration**: 1-2 seconds
- **Easing**: `ease-out` (fast start, slow finish for emphasis on final number)
- **Implementation approach**:
  ```jsx
  // Using CountUp.js or custom implementation
  // Key: use requestAnimationFrame for smooth updates
  function countUp(element, target, duration = 1500) {
    const start = performance.now();
    const initial = parseInt(element.textContent) || 0;

    function update(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      element.textContent = Math.round(initial + (target - initial) * eased);
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }
  ```
- **Psychology**: Counting up creates a sense of accumulation and achievement. The ease-out curve makes the final digits "settle" prominently, drawing attention to the end value.

#### Chart Animation
- **Description**: Bars grow from zero height, lines draw from left to right
- **Duration**: 500-800ms with staggered entry
- **Easing**: `ease-out` for bars, `ease-in-out` for lines
- **Stagger**: 50-100ms between data points
- **Psychology**: Sequential reveal guides the eye through data in a meaningful order and makes the visualization feel "alive" and current.

#### Status Change
- **Description**: Status badge crossfades color with subtle scale pulse
- **Duration**: 300ms for color transition, 200ms for scale pulse
- **Easing**: `ease-in-out`
- **CSS approach**:
  ```css
  .status-badge {
    transition: background-color 300ms ease-in-out,
                color 300ms ease-in-out;
  }
  .status-badge.updated {
    animation: status-pulse 300ms ease-in-out;
  }
  @keyframes status-pulse {
    50% { transform: scale(1.1); }
  }
  ```
- **Psychology**: The pulse draws attention to the change (combating change blindness) while the smooth color transition makes the change feel intentional, not jarring.

---

## 3. AI-Specific Animations

### 3.1 Streaming Text Appearance

#### Approach A: Token-by-Token (ChatGPT-style)
- **Description**: Text appears character/token at a time as received from API via Server-Sent Events
- **Timing**: ~5ms per character (200 characters/second) for readable pacing
- **Cursor**: Blinking block or line cursor at the end of streaming text
- **Implementation**:
  ```jsx
  // Receive tokens from SSE stream
  // Buffer and render at consistent pace
  const CHAR_INTERVAL = 5; // ms per character

  function StreamingText({ stream }) {
    const [displayed, setDisplayed] = useState('');
    const bufferRef = useRef('');

    useEffect(() => {
      const interval = setInterval(() => {
        if (bufferRef.current.length > displayed.length) {
          setDisplayed(prev => bufferRef.current.slice(0, prev.length + 1));
        }
      }, CHAR_INTERVAL);
      return () => clearInterval(interval);
    }, [displayed]);

    // ... SSE connection fills bufferRef
  }
  ```
- **Cursor CSS**:
  ```css
  .streaming-cursor {
    display: inline-block;
    width: 2px;
    height: 1.2em;
    background: currentColor;
    animation: blink 1s step-end infinite;
    margin-left: 1px;
    vertical-align: text-bottom;
  }
  @keyframes blink {
    50% { opacity: 0; }
  }
  ```
- **Why it works**: Mimics human typing, creating conversational intimacy. Reduces perceived latency because users start reading immediately instead of waiting for full response.

#### Approach B: Word-by-Word Fade-In
- **Description**: Each word fades in individually with slight Y offset
- **Timing**: ~30-50ms stagger between words
- **Better for**: Polished summaries, final results, non-chat contexts
- **Implementation**:
  ```jsx
  // Split text into words, stagger their appearance
  {words.map((word, i) => (
    <motion.span
      key={i}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.04, duration: 0.3 }}
    >
      {word}{' '}
    </motion.span>
  ))}
  ```
- **Why it works**: More polished than token-by-token. Creates a "materialization" effect that feels AI-native rather than mimicking human typing.

#### Approach C: Line-by-Line (Code Generation)
- **Description**: Each line of code appears sequentially with syntax highlighting
- **Timing**: ~50-80ms stagger between lines
- **Used by**: v0.dev, GitHub Copilot, Cursor
- **Implementation**:
  ```jsx
  {codeLines.map((line, i) => (
    <motion.div
      key={i}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: i * 0.06, duration: 0.2, ease: "easeOut" }}
    >
      <SyntaxHighlightedLine code={line} />
    </motion.div>
  ))}
  ```
- **Why it works**: Maps to how developers mentally process code (line by line). The left-to-right slide subtly mimics "writing."

### 3.2 Thinking Indicators

#### Bouncing Dots
- **Description**: Three dots bounce vertically in sequence
- **Duration**: ~1200ms per cycle
- **Stagger**: 200ms between each dot
- **CSS approach**:
  ```css
  .thinking-dots span {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-tertiary);
    margin: 0 2px;
    animation: bounce 1.2s ease-in-out infinite;
  }
  .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
  .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }

  @keyframes bounce {
    0%, 60%, 100% { transform: translateY(0); }
    30% { transform: translateY(-8px); }
  }
  ```
- **Reduced motion alternative**: Replace bounce with opacity pulse
- **Why it works**: Sequential motion suggests "processing steps." The dots are a universal "typing" indicator from messaging apps.

#### Shimmer Bar (Extended Thinking)
- **Description**: A horizontal bar with a traveling shimmer effect, optionally with status text
- **Duration**: 2-3s per shimmer cycle
- **Used by**: ChatGPT "thinking" mode, Claude thinking indicator
- **CSS approach**:
  ```css
  .thinking-bar {
    height: 3px;
    background: var(--surface-tertiary);
    border-radius: 2px;
    position: relative;
    overflow: hidden;
  }
  .thinking-bar::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      var(--brand-primary) 50%,
      transparent 100%
    );
    animation: thinking-shimmer 2s ease-in-out infinite;
  }
  @keyframes thinking-shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
  ```
- **Why it works**: Indicates active processing without committing to a timeframe. The shimmer suggests movement and progress even when the actual duration is unknown.

#### Pulsing Ring / Orb
- **Description**: Concentric rings pulse outward from a central point, or a glowing orb breathes
- **Duration**: 1.5-2s per cycle
- **Used by**: Many AI assistants for "listening" or "processing" states
- **CSS approach**:
  ```css
  .ai-orb {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--brand-primary);
    animation: orb-pulse 2s ease-in-out infinite;
    box-shadow: 0 0 20px var(--brand-primary-alpha-30);
  }
  @keyframes orb-pulse {
    0%, 100% {
      transform: scale(1);
      box-shadow: 0 0 20px var(--brand-primary-alpha-30);
    }
    50% {
      transform: scale(1.08);
      box-shadow: 0 0 40px var(--brand-primary-alpha-50);
    }
  }
  ```
- **Why it works**: Breathing/pulsing is calming and organic, creating a sense that the AI is "alive" and working. The glow adds a futuristic quality.

### 3.3 Agent Status Indicators

- **Queued/Waiting**: Subtle pulse, muted color, slow rhythm (2s cycle)
- **Processing/Running**: Active shimmer or spinner, brand color, faster rhythm (1s cycle)
- **Streaming/Outputting**: Blinking cursor + text stream, high contrast
- **Complete/Success**: Checkmark draw + color shift to green, ~500ms
- **Error/Failed**: Shake + color shift to red, ~400ms
- **Each transition between states**: 200-300ms crossfade

---

## 4. Timing & Easing Reference

### Duration Hierarchy

| Animation Type | Duration | Notes |
|---|---|---|
| Button press feedback | 50-100ms | Must feel instant |
| Hover state change | 150-200ms | Quick but perceivable |
| Toggle/checkbox | ~100ms | Should feel like physical manipulation |
| Dropdown open | 150-200ms | Fast enough to not block task |
| Dropdown close | 100-150ms | Faster than open |
| Modal open | 200-250ms | Slightly slower to build importance |
| Modal close | 150-200ms | Faster out than in |
| Page transition | 200-300ms | Longer for context switch |
| Sidebar toggle | 250-300ms | Medium -- significant layout change |
| Toast enter | 250-350ms | Needs to catch peripheral attention |
| Toast exit | 150-200ms | Get out of the way quickly |
| Scroll reveal | 300-500ms | Can be slower -- not blocking interaction |
| Loading shimmer | 1500-2000ms | Slow, continuous, ambient |
| Chart/data animation | 500-800ms | Longer for comprehension |
| Success confirmation | 500-700ms | Allows moment of satisfaction |
| Number count-up | 1000-2000ms | Entertainment/engagement |

### The Asymmetry Rule

**Enter animations should be slower than exit animations.** Rationale:
- Enter: User needs to perceive and process new content (brain needs time to register)
- Exit: User has already decided to dismiss; fast removal respects their intent
- Typical ratio: Enter is 1.3-1.5x the duration of Exit

### Easing Curve Reference

| Easing | CSS Value | Best For |
|---|---|---|
| **Ease-out** | `cubic-bezier(0.25, 0.46, 0.45, 0.94)` | Elements entering, user-initiated actions, dropdowns |
| **Ease-in** | `cubic-bezier(0.55, 0.085, 0.68, 0.53)` | Elements exiting, dismissals |
| **Ease-in-out** | `cubic-bezier(0.42, 0, 0.58, 1)` | Morphing, position changes while on-screen |
| **Snappy ease-out** | `cubic-bezier(0.16, 1, 0.3, 1)` | Quick interactions, Linear-style snappiness |
| **Overshoot** | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Playful enters, toast notifications |
| **Smooth decel** | `cubic-bezier(0, 0, 0.2, 1)` | Material-style enters |
| **Sharp accel** | `cubic-bezier(0.4, 0, 1, 1)` | Material-style exits |
| **Linear** | `linear` | Opacity fades, color changes, continuous rotation, shimmer |
| **Spring (Motion)** | `{ type: "spring", stiffness: 200, damping: 20 }` | Most interactive elements |
| **Bouncy spring** | `{ type: "spring", stiffness: 300, damping: 15 }` | Playful, attention-grabbing |
| **Stiff spring** | `{ type: "spring", stiffness: 400, damping: 30 }` | Snappy, professional |

### Key Principle: When to Use What Easing

- **Transform (position, scale, rotation)**: Spring or ease-out -- these properties benefit most from natural-feeling motion
- **Opacity**: `linear` -- the human eye perceives opacity changes linearly, so easing creates uneven-looking fades
- **Color / background-color**: `linear` -- produces the most even color blending
- **Box-shadow**: `ease-out` -- but prefer animating a pseudo-element's opacity for performance

---

## 5. Spring Physics Guide

### Core Parameters

| Parameter | Description | Low Value Effect | High Value Effect |
|---|---|---|---|
| **Stiffness** (tension) | How tightly wound the spring is | Loose, slow response (~50) | Snappy, bouncy animation (~400) |
| **Damping** (friction) | Force that slows the spring | More oscillation/bounce (~5) | Smooth, no bounce (~40) |
| **Mass** | Weight of the animated object | Light, quick response (0.5) | Heavy, more inertia (3.0) |

### Recommended Presets for UI

| Use Case | Stiffness | Damping | Mass | Character |
|---|---|---|---|---|
| Button press | 400 | 17 | 0.8 | Snappy, responsive |
| Card hover | 200 | 20 | 1.0 | Smooth, professional |
| Modal appear | 300 | 25 | 1.0 | Confident entrance |
| Sidebar toggle | 200 | 25 | 1.0 | Steady, not bouncy |
| Tab indicator slide | 300 | 30 | 1.0 | Clean, precise |
| Drag and drop settle | 200 | 15 | 1.0 | Slight bounce on drop |
| Page transition | 250 | 25 | 1.0 | Balanced |
| Tooltip appear | 400 | 30 | 0.5 | Quick, no bounce |
| Notification enter | 250 | 20 | 1.0 | Gentle overshoot |
| Playful bounce | 300 | 10 | 1.0 | Bouncy, fun |

### Spring vs Duration-Based: When to Choose

**Use springs when:**
- The element is interactive (responding to user input)
- You want natural, physical-feeling motion
- The element changes position or scale
- Drag/gesture interactions

**Use duration-based when:**
- Animating opacity or color (springs have no visible effect)
- You need precise timing (e.g., synchronizing with audio or other animations)
- Loading/ambient animations (shimmer, pulse)
- You need exact start/end times

---

## 6. Performance Guidelines

### The Golden Rules

1. **Only animate `transform` and `opacity`** -- these are the only properties guaranteed to run on the GPU compositor thread, avoiding main-thread jank
2. **Target 60fps minimum** (16.7ms per frame), 120fps on ProMotion displays (8.3ms per frame)
3. **Never animate layout properties**: `width`, `height`, `padding`, `margin`, `top`, `left`, `right`, `bottom` all trigger expensive layout recalculation

### Performance-Safe Properties

| Property | Performance | Notes |
|---|---|---|
| `transform: translate()` | Excellent | GPU-composited, use instead of top/left |
| `transform: scale()` | Excellent | GPU-composited, use instead of width/height |
| `transform: rotate()` | Excellent | GPU-composited |
| `opacity` | Excellent | GPU-composited |
| `filter` | Good | GPU-composited in modern browsers |
| `clip-path` | Good | Emerging compositor support |
| `background-color` | Moderate | Triggers paint, not layout |
| `box-shadow` | Poor | Triggers paint every frame; use pseudo-element + opacity trick |
| `border-radius` | Poor | Triggers paint; use `clip-path: inset()` for animated rounding |
| `width` / `height` | Bad | Triggers layout recalculation |
| `padding` / `margin` | Bad | Triggers layout recalculation |

### The Box-Shadow Performance Trick

Instead of animating `box-shadow` directly:
```css
.card {
  position: relative;
}
.card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
  opacity: 0;
  transition: opacity 200ms ease-out;
  pointer-events: none;
}
.card:hover::after {
  opacity: 1;
}
```
This animates `opacity` (GPU-composited) instead of `box-shadow` (paint-heavy).

### `will-change` Usage

```css
/* Apply ONLY to elements that will animate */
.will-animate {
  will-change: transform, opacity;
}
/* Remove after animation completes for static elements */
```

**Caution**: Each `will-change` element creates a GPU layer. Too many layers consume GPU memory. Apply sparingly and remove when not actively animating.

### Motion Library (Framer Motion) Performance

- Uses Web Animations API for hardware-accelerated animations off the main JS thread
- `layout` animations use `transform` under the hood, even when animating layout properties
- For best performance, animate `x`, `y`, `scale`, `rotate`, `opacity`
- Avoid animating `width`, `height` directly -- use `layout` prop instead, which internally uses transforms

### Animation Frame Budget

At 60fps, you have 16.7ms per frame. Budget allocation:
- JavaScript execution: <4ms
- Style recalculation: <2ms
- Layout: <2ms (ideally 0ms if only animating transform/opacity)
- Paint: <2ms (ideally 0ms)
- Composite: <2ms
- **Remaining for browser overhead**: ~4ms

---

## 7. Accessibility Requirements

### `prefers-reduced-motion` Implementation

**Critical rule**: `reduce` does NOT mean `none`. Users expect reduced motion, not eliminated animation.

#### CSS Approach
```css
/* Default: full animations */
.animated-element {
  transition: transform 300ms ease-out, opacity 300ms ease-out;
}

/* Reduced motion: remove transform, keep opacity */
@media (prefers-reduced-motion: reduce) {
  .animated-element {
    transition: opacity 200ms ease;
    transform: none !important;
  }

  /* Disable all transform-based animations */
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

#### "No-Motion-First" Approach (Recommended)
```css
/* Base: no motion */
.element {
  opacity: 1;
  /* No transitions by default */
}

/* Opt-in to motion */
@media (prefers-reduced-motion: no-preference) {
  .element {
    transition: transform 300ms ease-out, opacity 300ms ease-out;
  }
}
```

#### JavaScript Detection
```javascript
const prefersReducedMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)'
).matches;

// Framer Motion
<motion.div
  animate={{ x: 100 }}
  transition={prefersReducedMotion
    ? { duration: 0 }
    : { type: "spring", stiffness: 200, damping: 20 }
  }
/>
```

### What to Reduce vs Remove

| Animation Type | Full Motion | Reduced Motion |
|---|---|---|
| Page transitions | Slide + fade | Crossfade only |
| Hover effects | Scale + translate | Opacity change only |
| Loading shimmer | Moving gradient | Static pulse (opacity) |
| Scroll reveal | Slide up + fade | Instant appear or simple fade |
| Success checkmark | SVG draw animation | Instant checkmark display |
| Error shake | Horizontal shake | Red border/background (static) |
| Thinking dots | Bouncing dots | Slow opacity pulse |
| Toast notifications | Slide in | Instant appear with fade |
| Sidebar collapse | Width + slide | Instant toggle |
| Number count-up | Animated counting | Instant final number |

### Additional Requirements

- Animations lasting >5 seconds must have a pause/stop mechanism
- No content should flash more than 3 times per second (WCAG 2.3.1)
- Use `role="status"` or `aria-live="polite"` for dynamically changing content
- Ensure animated transitions do not remove focus indicators

---

## 8. Decision Framework: When to Animate

### Animate When:

1. **Providing feedback**: User clicked something -- confirm the action was registered
2. **Showing state change**: Something changed in the system (status update, new data)
3. **Guiding attention**: Drawing the eye to important new information (combating change blindness)
4. **Building spatial mental models**: Showing where elements come from/go to during navigation
5. **Reducing perceived wait time**: Skeleton screens, progress indicators during loading
6. **Smoothing transitions**: Preventing jarring jumps when content changes

### Do NOT Animate When:

1. **Speed is critical**: Search results, autocomplete, real-time data -- users need instant response
2. **The user is in a flow state**: Repetitive actions (filing emails, toggling many items) -- animation becomes annoying on the 10th repetition
3. **It delays task completion**: If animation adds waiting time, cut it
4. **Decoration only**: Animation that serves no informational purpose is noise
5. **Complex content is loading**: A heavy animation during loading competes for CPU with the actual content load
6. **User has seen it many times**: First-time delight becomes repetitive friction

### The "10th Time" Test

Ask: "Will this animation still feel good on the 10th interaction?" If yes, keep it. If it will feel slow or annoying, make it faster or remove it.

### Animation Priority Tiers

**Tier 1 -- Always Animate (Functional)**:
- Loading states (skeleton, spinner)
- Success/error feedback
- Focus indicators
- State transitions (toggle, checkbox)

**Tier 2 -- Usually Animate (Enhancement)**:
- Page/route transitions
- Hover effects on interactive elements
- Toast notifications
- Modal/dialog enter/exit
- Dropdown menus

**Tier 3 -- Sometimes Animate (Delight)**:
- Scroll reveal
- Number count-up
- Chart animations
- Shared element transitions

**Tier 4 -- Rarely Animate (Caution)**:
- Background ambient effects
- Parallax scrolling
- Text animations on static content
- Decorative illustrations

---

## Appendix: Quick Reference for AskElira Implementation

### Recommended Animation Stack
- **Library**: Motion (formerly Framer Motion) via `motion/react`
- **CSS transitions**: For simple hover states, focus rings, color changes
- **CSS keyframes**: For loading animations (shimmer, pulse, spin)
- **Motion**: For page transitions, layout animations, gesture responses, enter/exit

### Priority Animations for an AI Product

1. **AI response streaming** -- Token-by-token with blinking cursor (most impactful)
2. **Thinking indicator** -- Bouncing dots or shimmer bar during processing
3. **Skeleton loading** -- For initial page load and data fetching
4. **Success/error feedback** -- Checkmarks, shakes, toasts after actions
5. **Page transitions** -- Subtle fade + slide between routes
6. **Hover states** -- Buttons, cards, interactive elements
7. **Sidebar navigation** -- Smooth expand/collapse

### Suggested Default Transition

```css
/* Global sensible default */
:root {
  --transition-fast: 150ms;
  --transition-base: 200ms;
  --transition-slow: 300ms;
  --transition-slower: 500ms;
  --ease-out: cubic-bezier(0.25, 0.46, 0.45, 0.94);
  --ease-in: cubic-bezier(0.55, 0.085, 0.68, 0.53);
  --ease-in-out: cubic-bezier(0.42, 0, 0.58, 1);
  --ease-snappy: cubic-bezier(0.16, 1, 0.3, 1);
}
```

```jsx
// Framer Motion default transition
const defaultTransition = {
  type: "spring",
  stiffness: 200,
  damping: 20,
  mass: 1,
};
```

---

## Sources

### Micro-Animations & SaaS Trends
- [Why SaaS Websites Are Moving to Interactive Hero Animations in 2026](https://dev.to/uianimation/why-saas-websites-are-moving-to-interactive-hero-animations-in-2026-16l4)
- [12 Micro Animation Examples in 2025](https://bricxlabs.com/blogs/micro-interactions-2025-examples)
- [2026 Web Design Trends: Glassmorphism, Micro-Animations & AI](https://www.digitalupward.com/blog/2026-web-design-trends-glassmorphism-micro-animations-ai-magic/)
- [UI/UX Evolution 2026: Micro-Interactions & Motion](https://primotech.com/ui-ux-evolution-2026-why-micro-interactions-and-motion-matter-more-than-ever/)
- [10 Best UI Animation Examples for SaaS](https://www.motiontheagency.com/blog/ui-animation-examples)
- [Micro Interactions in Web Design: How Subtle Details Shape UX](https://www.stan.vision/journal/micro-interactions-2025-in-web-design)

### Framer Motion / Motion Library
- [Advanced Animation Patterns with Framer Motion - Maxime Heckel](https://blog.maximeheckel.com/posts/advanced-animation-patterns-with-framer-motion/)
- [Framer Motion + Tailwind: The 2025 Animation Stack](https://dev.to/manukumar07/framer-motion-tailwind-the-2025-animation-stack-1801)
- [Motion - JavaScript & React Animation Library](https://motion.dev/)
- [Motion Performance Guide](https://motion.dev/docs/performance)
- [Framer: 11 Strategic Animation Techniques](https://www.framer.com/blog/website-animation-examples/)

### Easing & Spring Physics
- [Springs and Bounces in Native CSS - Josh W. Comeau](https://www.joshwcomeau.com/animation/linear-timing-function/)
- [A Friendly Introduction to Spring Physics - Josh W. Comeau](https://www.joshwcomeau.com/animation/a-friendly-introduction-to-spring-physics/)
- [The Easing Blueprint - animations.dev](https://animations.dev/learn/animation-theory/the-easing-blueprint)
- [CSS linear() Easing Function - Chrome Developers](https://developer.chrome.com/docs/css-ui/css-linear-easing-function)
- [Designing Spring Animations for the Web](https://felixrunquist.com/posts/designing-spring-animations-for-the-web)
- [Animation Easings Handbook](https://pow.rs/blog/animation-easings/)

### Loading & Skeleton Patterns
- [Skeleton Loading Screen Design - LogRocket](https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/)
- [Skeleton Screens 101 - Nielsen Norman Group](https://www.nngroup.com/articles/skeleton-screens/)
- [How to Build a Skeleton Loading Placeholder](https://www.letsbuildui.dev/articles/how-to-build-a-skeleton-loading-placeholder/)
- [CSS Skeleton Loading: Shimmer, Pulse & Wave Effects](https://frontend-hero.com/how-to-create-skeleton-loader)

### AI-Specific Patterns
- [AI UI Patterns - patterns.dev](https://www.patterns.dev/react/ai-ui-patterns/)
- [Smooth Text Streaming in AI SDK v5 - Upstash](https://upstash.com/blog/smooth-streaming)
- [Understanding the ChatGPT Typewriter Effect](https://medium.com/@shakirshakeel/understanding-the-chatgpt-typewriter-effect-more-than-just-eye-candy-b576adb64027)
- [How to Build the ChatGPT Typing Animation in React](https://dev.to/stiaanwol/how-to-build-the-chatgpt-typing-animation-in-react-2cca)

### UX Research & Guidelines
- [Executing UX Animations: Duration and Motion - Nielsen Norman Group](https://www.nngroup.com/articles/animation-duration/)
- [The Role of Animation and Motion in UX - Nielsen Norman Group](https://www.nngroup.com/articles/animation-purpose-ux/)
- [6 Animation Guidelines for UX Design](https://www.everyinteraction.com/articles/6-animation-guidelines-ux-design/)
- [Animation and Motion Standards - ASU Brand Guide](https://brandguide.asu.edu/execution-guidelines/web/ux-design/animation)

### Product-Specific Analysis
- [How to Create Vercel-Style Navigation Animation](https://abubalogun.medium.com/how-to-create-vercel-style-navigation-animation-09d169961f12)
- [Stripe Connect: Behind the Front-End Experience](https://stripe.com/blog/connect-front-end-experience)
- [Stripe Performance Analysis - Quora](https://www.quora.com/What-does-Stripe-do-to-make-all-their-animations-so-performant)
- [Stripe Navigation Tutorial - Lokesh Dhakar](https://lokeshdhakar.com/dev-201-stripe.coms-main-navigation/)
- [Sidebar Animation Performance (Notion-style)](https://www.joshuawootonn.com/sidebar-animation-performance)

### Accessibility
- [Design Accessible Animation and Movement](https://blog.pope.tech/2025/12/08/design-accessible-animation-and-movement/)
- [prefers-reduced-motion - MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
- [prefers-reduced-motion: No-Motion-First Approach - Tatiana Mac](https://www.tatianamac.com/posts/prefers-reduced-motion)
- [WCAG 2.1: Animation from Interactions](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html)

### Performance
- [How to Achieve Smooth CSS Animations: 60 FPS Guide](https://ipixel.com.sg/web-development/how-to-achieve-smooth-css-animations-60-fps-performance-guide/)
- [CSS GPU Animation: Doing It Right - Smashing Magazine](https://www.smashingmagazine.com/2016/12/gpu-animation-doing-it-right/)
- [CSS GPU Acceleration Techniques](https://www.usefulfunctions.co.uk/2025/11/08/css-animation-performance-gpu-acceleration-techniques/)

### Hover & Feedback Animations
- [CSS Hover Effects: 40 Engaging Animations](https://prismic.io/blog/css-hover-effects)
- [How to Animate Box-Shadow with Performance](https://tobiasahlin.com/blog/how-to-animate-box-shadow/)
- [Best Practices for Animating Micro-Interactions with CSS](https://blog.pixelfreestudio.com/best-practices-for-animating-micro-interactions-with-css/)
- [Building a Toast Component - web.dev](https://web.dev/articles/building/a-toast-component)
