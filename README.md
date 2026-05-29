# Precision Logistics Tracker

A complete, production-grade package tracking website using Next.js 14 App Router, built with an enterprise-grade "Precision Logistics" design.

## Tech Stack
- **Framework:** Next.js 14
- **Language:** TypeScript
- **Styling:** Tailwind CSS v3
- **Animations:** Framer Motion
- **State Management:** Zustand
- **Data Fetching:** TanStack Query
- **Database:** Prisma ORM

## Setup

1. **Install dependencies:**
   `npm install`
   
2. **Setup environment variables:**
   Copy `.env.example` to `.env` and fill in necessary connection details.

3. *(Optional for Postgres Backend)*
   Run migrations and seed the database if you provide a `DATABASE_URL`:
   `npx prisma migrate dev`
   `npx prisma db seed`

4. **Run development server:**
   `npm run dev`

The app runs on port 3000. Try entering the mock tracking number `9400111899223450980545` to see the complete timeline interface!
