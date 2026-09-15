// Experiment 13 reference kernels (exactly as specified) + exhaustive native truth tables.
#include <stdint.h>
#include <stdio.h>

uint8_t step(int8_t error, uint8_t acc) {
    if (error > 0 && acc < 255) acc++;
    else if (error < 0 && acc > 0) acc--;
    return acc;
}

uint8_t parity(uint8_t x) {
    x ^= x >> 4;
    x ^= x >> 2;
    x ^= x >> 1;
    return x & 1;
}

uint8_t gcd8(uint8_t a, uint8_t b) {
    while (b != 0) {
        uint8_t t = a % b;
        a = b;
        b = t;
    }
    return a;
}

// repeated-subtraction variant (no modulo), returns loop iterations through *iters
uint8_t gcd8_sub(uint8_t a, uint8_t b, int *iters) {
    int n = 0;
    if (a == 0) { *iters = 0; return b; }
    while (b != 0) {
        if (a > b) a = a - b; else b = b - a;
        n++;
    }
    *iters = n;
    return a;
}

#ifndef NO_MAIN
int main(void) {
    FILE *f = fopen("../out/13/ref_step.csv", "w");
    fprintf(f, "error,acc,out\n");
    for (int e = -128; e < 128; e++) for (int a = 0; a < 256; a++) fprintf(f, "%d,%d,%d\n", e, a, step((int8_t)e, (uint8_t)a));
    fclose(f);
    f = fopen("../out/13/ref_parity.csv", "w");
    fprintf(f, "x,out\n");
    for (int x = 0; x < 256; x++) fprintf(f, "%d,%d\n", x, parity((uint8_t)x));
    fclose(f);
    f = fopen("../out/13/ref_gcd8.csv", "w");
    fprintf(f, "a,b,out,out_sub,iters_mod,iters_sub\n");
    for (int a = 0; a < 256; a++) for (int b = 0; b < 256; b++) {
        int it = 0; uint8_t x = a, y = b; while (y) { uint8_t t = x % y; x = y; y = t; it++; }
        int is = 0; uint8_t s = gcd8_sub((uint8_t)a, (uint8_t)b, &is);
        fprintf(f, "%d,%d,%d,%d,%d,%d\n", a, b, gcd8((uint8_t)a, (uint8_t)b), s, it, is);
    }
    fclose(f);
    return 0;
}
#endif
