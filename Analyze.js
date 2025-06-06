const fs = require('fs');

class BrowserTestAnalyzer {
    constructor() {
        this.results = {
            browsers: {},
            totalTests: 0,
            totalBrowsers: 0,
            sessionTypes: new Set(),
            testTypes: new Set(),
            summary: {}
        };
    }

    analyze(content) {
        console.log("Starting analysis...");

        try {
            const jsonData = JSON.parse(content);
            if (jsonData.all_tests && Array.isArray(jsonData.all_tests)) {
                return this.analyzeCompleteJSON(jsonData);
            }
        } catch (e) {
            console.log("JSON parsing failed, analyzing raw content...");
        }

        return this.analyzeRawContent(content);
    }

    analyzeCompleteJSON(data) {
        console.log(`Processing ${data.all_tests.length} browser test entries...`);

        data.all_tests.forEach((browserEntry) => {
            const browser = browserEntry.browser;
            const browserKey = this.createBrowserKey(browserEntry);

            if (!this.results.browsers[browserKey]) {
                this.results.browsers[browserKey] = {
                    name: browser,
                    passed: 0,
                    failed: 0,
                    unsupported: 0,
                    total: 0,
                    sessions: {},
                    tests: [],
                    metadata: {
                        incognito: browserEntry.incognito || false,
                        tor: browserEntry.tor || false,
                        nightly: browserEntry.nightly || false
                    }
                };
                this.results.totalBrowsers++;
            }

            Object.keys(browserEntry.testResults || {}).forEach(sessionType => {
                this.results.sessionTypes.add(sessionType);

                if (!this.results.browsers[browserKey].sessions[sessionType]) {
                    this.results.browsers[browserKey].sessions[sessionType] = {
                        passed: 0,
                        failed: 0,
                        unsupported: 0,
                        total: 0,
                        tests: []
                    };
                }

                const sessionTests = browserEntry.testResults[sessionType];

                Object.keys(sessionTests).forEach(testName => {
                    const test = sessionTests[testName];
                    this.results.testTypes.add(testName);

                    const testResult = this.analyzeTestResult(test, testName, sessionType, browserKey);

                    this.results.browsers[browserKey].tests.push(testResult);
                    this.results.browsers[browserKey].total++;
                    this.results.browsers[browserKey].sessions[sessionType].total++;
                    this.results.totalTests++;

                    if (testResult.unsupported) {
                        this.results.browsers[browserKey].unsupported++;
                        this.results.browsers[browserKey].sessions[sessionType].unsupported++;
                    } else if (testResult.passed) {
                        this.results.browsers[browserKey].passed++;
                        this.results.browsers[browserKey].sessions[sessionType].passed++;
                    } else {
                        this.results.browsers[browserKey].failed++;
                        this.results.browsers[browserKey].sessions[sessionType].failed++;
                    }

                    this.results.browsers[browserKey].sessions[sessionType].tests.push(testResult);
                });
            });
        });

        this.calculateSummary();
        return this.results;
    }

    analyzeRawContent(content) {
        console.log("Analyzing raw content...");

        const browserEntries = this.extractBrowserEntries(content);

        browserEntries.forEach(entry => {
            const browserKey = entry.browser + (entry.incognito ? '_incognito' : '') +
                              (entry.tor ? '_tor' : '') + (entry.nightly ? '_nightly' : '');

            if (!this.results.browsers[browserKey]) {
                this.results.browsers[browserKey] = {
                    name: entry.browser,
                    passed: 0,
                    failed: 0,
                    unsupported: 0,
                    total: 0,
                    sessions: {},
                    tests: [],
                    metadata: entry.metadata
                };
                this.results.totalBrowsers++;
            }

            entry.tests.forEach(test => {
                this.results.testTypes.add(test.name);
                this.results.sessionTypes.add(test.session);

                this.results.browsers[browserKey].tests.push(test);
                this.results.browsers[browserKey].total++;
                this.results.totalTests++;

                if (test.unsupported) {
                    this.results.browsers[browserKey].unsupported++;
                } else if (test.passed) {
                    this.results.browsers[browserKey].passed++;
                } else {
                    this.results.browsers[browserKey].failed++;
                }
            });
        });

        this.calculateSummary();
        return this.results;
    }

    extractBrowserEntries(content) {
        const entries = [];

        const browserPattern = /"browser":"([^"]+)"[^}]*"incognito":(true|false)[^}]*"tor":(true|false)[^}]*"nightly":(true|false)/g;
        const matches = [...content.matchAll(browserPattern)];

        if (matches.length === 0) {
            const simpleBrowserPattern = /"browser":"([^"]+)"/g;
            const simpleMatches = [...content.matchAll(simpleBrowserPattern)];

            simpleMatches.forEach(match => {
                entries.push({
                    browser: match[1],
                    incognito: false,
                    tor: false,
                    nightly: false,
                    metadata: { incognito: false, tor: false, nightly: false },
                    tests: this.extractTestsForBrowser(content, match[1])
                });
            });
        } else {
            matches.forEach(match => {
                entries.push({
                    browser: match[1],
                    incognito: match[2] === 'true',
                    tor: match[3] === 'true',
                    nightly: match[4] === 'true',
                    metadata: {
                        incognito: match[2] === 'true',
                        tor: match[3] === 'true',
                        nightly: match[4] === 'true'
                    },
                    tests: this.extractTestsForBrowser(content, match[1])
                });
            });
        }

        return entries;
    }

    extractTestsForBrowser(content, browser) {
        const tests = [];

        const testPattern = /"([^"]+)":\{[^}]*"unsupported":(true|false)[^}]*"testFailed":(true|false)[^}]*(?:"passed":(true|false))?/g;
        const testMatches = [...content.matchAll(testPattern)];

        testMatches.forEach(match => {
            const testName = match[1];
            const unsupported = match[2] === 'true';
            const testFailed = match[3] === 'true';
            const passed = match[4] === 'true';

            if (testName === 'testResults' || testName.startsWith('session_')) {
                return;
            }

            tests.push({
                name: testName,
                session: 'session_3p',
                passed: passed,
                unsupported: unsupported,
                testFailed: testFailed,
                browser: browser
            });
        });

        return tests;
    }

    analyzeTestResult(test, testName, sessionType, browserKey) {
        return {
            name: testName,
            session: sessionType,
            passed: test.passed === true,
            unsupported: test.unsupported === true,
            testFailed: test.testFailed === true,
            description: test.description || '',
            readSameSession: test.readSameSession || null,
            readDifferentSession: test.readDifferentSession || null,
            browser: browserKey
        };
    }

    createBrowserKey(browserEntry) {
        let key = browserEntry.browser;
        if (browserEntry.incognito) key += '_incognito';
        if (browserEntry.tor) key += '_tor';
        if (browserEntry.nightly) key += '_nightly';
        return key;
    }

    calculateSummary() {
        let totalPassRate = 0;
        let bestPerformer = null;
        let worstPerformer = null;
        let bestRate = -1;
        let worstRate = 101;

        Object.entries(this.results.browsers).forEach(([browserKey, stats]) => {
            const passRate = stats.total > 0 ? (stats.passed / stats.total) * 100 : 0;
            totalPassRate += passRate;

            if (passRate > bestRate) {
                bestRate = passRate;
                bestPerformer = { browser: browserKey, rate: passRate };
            }

            if (passRate < worstRate) {
                worstRate = passRate;
                worstPerformer = { browser: browserKey, rate: passRate };
            }
        });

        this.results.summary = {
            totalBrowsers: this.results.totalBrowsers,
            totalTests: this.results.totalTests,
            totalTestTypes: this.results.testTypes.size,
            totalSessionTypes: this.results.sessionTypes.size,
            averagePassRate: this.results.totalBrowsers > 0 ? totalPassRate / this.results.totalBrowsers : 0,
            bestPerformer,
            worstPerformer,
            sessionTypes: [...this.results.sessionTypes],
            testTypes: [...this.results.testTypes]
        };
    }

    generateReport() {
        let report = "=".repeat(80) + "\n";
        report += "                    COMPREHENSIVE BROWSER TEST ANALYSIS\n";
        report += "=".repeat(80) + "\n\n";

        report += "OVERALL SUMMARY:\n";
        report += "-".repeat(50) + "\n";
        report += `Total browsers tested: ${this.results.summary.totalBrowsers}\n`;
        report += `Total tests performed: ${this.results.summary.totalTests}\n`;
        report += `Unique test types: ${this.results.summary.totalTestTypes}\n`;
        report += `Session types: ${this.results.summary.sessionTypes.join(', ')}\n`;
        report += `Average pass rate: ${this.results.summary.averagePassRate.toFixed(1)}%\n\n`;

        if (this.results.summary.bestPerformer) {
            report += `🏆 Best performer: ${this.results.summary.bestPerformer.browser} (${this.results.summary.bestPerformer.rate.toFixed(1)}%)\n`;
        }
        if (this.results.summary.worstPerformer) {
            report += `📉 Worst performer: ${this.results.summary.worstPerformer.browser} (${this.results.summary.worstPerformer.rate.toFixed(1)}%)\n\n`;
        }

        report += "BROWSER BREAKDOWN:\n";
        report += "-".repeat(50) + "\n";

        const sortedBrowsers = Object.entries(this.results.browsers).sort((a, b) => {
            const rateA = a[1].total > 0 ? (a[1].passed / a[1].total) * 100 : 0;
            const rateB = b[1].total > 0 ? (b[1].passed / b[1].total) * 100 : 0;
            return rateB - rateA;
        });

        sortedBrowsers.forEach(([browserKey, stats]) => {
            const passRate = stats.total > 0 ? (stats.passed / stats.total) * 100 : 0;

            report += `\n${browserKey.toUpperCase().replace(/_/g, ' ')}:\n`;
            report += `  📊 Total tests: ${stats.total}\n`;
            report += `  ✅ Passed: ${stats.passed} (${((stats.passed / stats.total) * 100).toFixed(1)}%)\n`;
            report += `  ❌ Failed: ${stats.failed} (${((stats.failed / stats.total) * 100).toFixed(1)}%)\n`;
            report += `  ⚠️  Unsupported: ${stats.unsupported} (${((stats.unsupported / stats.total) * 100).toFixed(1)}%)\n`;

            const modes = [];
            if (stats.metadata.incognito) modes.push("Incognito");
            if (stats.metadata.tor) modes.push("Tor");
            if (stats.metadata.nightly) modes.push("Nightly");
            if (modes.length > 0) {
                report += `  🔒 Special modes: ${modes.join(", ")}\n`;
            }

            if (Object.keys(stats.sessions).length > 1) {
                report += `  📁 Session breakdown:\n`;
                Object.entries(stats.sessions).forEach(([session, sessionStats]) => {
                    const sessionRate = sessionStats.total > 0 ? (sessionStats.passed / sessionStats.total) * 100 : 0;
                    report += `     ${session}: ${sessionStats.passed}/${sessionStats.total} (${sessionRate.toFixed(1)}%)\n`;
                });
            }
        });

        report += "\n" + "=".repeat(80) + "\n";
        report += "TEST TYPE SUMMARY:\n";
        report += "-".repeat(50) + "\n";
        report += `Total unique test types: ${this.results.summary.testTypes.length}\n`;
        report += "Test types: " + this.results.summary.testTypes.join(", ") + "\n";

        return report;
    }

    generateSummaryTable() {
        let table = "\n" + "=".repeat(100) + "\n";
        table += "BROWSER COMPARISON TABLE\n";
        table += "=".repeat(100) + "\n";
        table += "Browser".padEnd(25) + "| Total | Passed | Failed | Unsupported | Pass Rate\n";
        table += "-".repeat(100) + "\n";

        const sortedBrowsers = Object.entries(this.results.browsers).sort((a, b) => {
            const rateA = a[1].total > 0 ? (a[1].passed / a[1].total) * 100 : 0;
            const rateB = b[1].total > 0 ? (b[1].passed / b[1].total) * 100 : 0;
            return rateB - rateA;
        });

        sortedBrowsers.forEach(([browserKey, stats]) => {
            const passRate = stats.total > 0 ? ((stats.passed / stats.total) * 100).toFixed(1) : "0.0";
            const browserName = browserKey.replace(/_/g, ' ');

            table += browserName.padEnd(25) + "| " +
                    stats.total.toString().padEnd(5) + " | " +
                    stats.passed.toString().padEnd(6) + " | " +
                    stats.failed.toString().padEnd(6) + " | " +
                    stats.unsupported.toString().padEnd(11) + " | " +
                    passRate + "%\n";
        });

        return table;
    }

    getResults() {
        return this.results;
    }
}

const [ , , inputPath ] = process.argv;

if (!inputPath) {
    console.error("ERROR: Please invoke this script with a path to your JSON (e.g. node analyze.js test-results.json)");
    process.exit(1);
}

let raw;
try {
    raw = fs.readFileSync(inputPath, "utf8");
} catch (err) {
    console.error(`ERROR: Unable to read '${inputPath}':`, err.message);
    process.exit(1);
}

const analyzer = new BrowserTestAnalyzer();
const analysisResult = analyzer.analyze(raw);

console.log(analyzer.generateReport());

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BrowserTestAnalyzer;
}
