# React for the frontend

The frontend is React. The product is a five-region IDE-style dashboard and its core is a node-edge canvas; React has by far the richest graph/canvas ecosystem (see ADR-0005) and the component libraries for the inspector, resizable panels and virtualized evidence/findings lists all target React first. Svelte/Vue would mean hand-rolling the node/edge interaction layer — undifferentiated work for a Phase-1 MVP that needs to prove domain value, not canvas plumbing.
