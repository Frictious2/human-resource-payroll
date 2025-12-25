CREATE TABLE IF NOT EXISTS `tblEOSCalc` (
  `ID` int(11) NOT NULL AUTO_INCREMENT,
  `CompanyID` int(11) DEFAULT NULL,
  `EOSDate` date DEFAULT NULL,
  
  -- Range 1
  `y1` int(11) DEFAULT 0,
  `d1` int(11) DEFAULT 0,
  `r1` decimal(18,2) DEFAULT 0.00,
  
  -- Range 2
  `y2` int(11) DEFAULT 0,
  `d2` int(11) DEFAULT 0,
  `r2` decimal(18,2) DEFAULT 0.00,
  
  -- Range 3
  `y3` int(11) DEFAULT 0,
  `d3` int(11) DEFAULT 0,
  `r3` decimal(18,2) DEFAULT 0.00,
  
  -- Range 4
  `y4` int(11) DEFAULT 0,
  `d4` int(11) DEFAULT 0,
  `r4` decimal(18,2) DEFAULT 0.00,
  
  -- Range 5
  `y5` int(11) DEFAULT 0,
  `d5` int(11) DEFAULT 0,
  `r5` decimal(18,2) DEFAULT 0.00,
  
  -- Ex-Gratia
  `e1` int(11) DEFAULT 0, -- S-Yrs 1
  `e2` int(11) DEFAULT 0, -- E-Yrs 1
  `b1` int(11) DEFAULT 0, -- Yrs 1
  
  `e3` int(11) DEFAULT 0, -- S-Yrs 2
  `e4` int(11) DEFAULT 0, -- E-Yrs 2
  `b2` int(11) DEFAULT 0, -- Yrs 2
  
  `ExGratiaMinAge` int(11) DEFAULT 0,
  
  -- Other Fields (Keeping these as they might be used later or were part of original req)
  `Exemption` decimal(18,2) DEFAULT 0.00,
  `TaxPercent` decimal(5,2) DEFAULT 0.00,
  `LongServiceStartYears` int(11) DEFAULT 0,
  `LongServicePercent` decimal(5,2) DEFAULT 0.00,
  `LongServiceUSD` decimal(18,2) DEFAULT 0.00,
  
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
