#pragma once
#include <Arduino.h>

struct UsageData {
    float session_pct;       // utilization 0-100 (5h window Pro/Max; spending % Enterprise)
    int session_reset_mins;  // minutes until reset
    float weekly_pct;        // 7-day utilization (Pro/Max only; 0 for Enterprise)
    int weekly_reset_mins;   // minutes until weekly reset (Pro/Max only)
    char status[16];         // "allowed", "limited", etc.
    bool chime;              // play the session-reset chime; false unless daemon opts in
    bool enterprise;         // true = Enterprise spending-limit account
    int time_pct;            // 0-100: fraction of billing period elapsed (Enterprise)
    int period_days;         // total billing period length in days (Enterprise)
    char reset_date[12];     // formatted reset date e.g. "Jul 1" (Enterprise)
    long clock_epoch;        // local wall-clock epoch (s) from daemon; 0 = not provided
    int  clock_fmt;          // 12 or 24 (hour format from daemon); defaults to 24
    // Weather, from the daemon's `weather = LAT,LON` setting. The device does
    // no networking of its own — same arrangement as clock_epoch above, and for
    // the same reason: the host already has the network, the credentials and a
    // maintained timezone database, and the device has none of those.
    //
    // weather_code is a WMO code (0 clear, 3 overcast, 61 rain, 95 storm, ...)
    // and is sent raw rather than pre-classified, so what counts as "rain
    // enough to change the animation" stays a device decision.
    int   weather_code;      // WMO weather code; -1 = no weather in this payload
    float weather_temp;      // degrees C; meaningless unless weather_code >= 0
    // Moon, from the same Open-Meteo call. moon_up is not "is it dark": the
    // moon spends much of most nights below the horizon, and plenty of days
    // above it, so the daemon compares the clock against moonrise/moonset
    // rather than against sunset.
    float moon_phase;        // 0..1 (0 new, .25 first quarter, .5 full); <0 = absent
    bool  moon_up;           // moon is above the horizon right now
    // Quotes, as the daemon's compact "k" string:
    //   "2317,255,-1.7|0050,106.45,+0.0"   ticker,last,percent — pipe separated
    // Kept as a string rather than parsed into a struct because the device only
    // ever prints it; splitting it here would mean fixing a maximum count in
    // two places instead of one. Empty means no quotes were sent.
    //
    // 96 bytes covers the daemon's cap of four tickers at their widest
    // (a six-digit code, a four-figure price and a two-digit move is 19 chars,
    // so four of those plus separators is 79). The whole payload was measured
    // at 204 bytes against a 253-byte MTU ceiling.
    char  stocks[96];
    bool  stocks_open;       // the Taiwan market is trading right now
    bool ok;                 // data parse succeeded
    bool valid;              // false until first successful parse
};
