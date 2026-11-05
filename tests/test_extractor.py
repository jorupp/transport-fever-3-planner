"""Small hand-authored fixtures; no game install needed for extractor unit tests."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('extract_tf3', pathlib.Path(__file__).resolve().parents[1]/'scripts/extract_tf3.py')
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


class ExtractorTests(unittest.TestCase):
    def test_air_thrust_regression_and_air_cost_formula(self):
        meta = {
            'transportVehicle': {'carrier':'AIR','comfortFactor':-1,'loadSpeed':3,
                'transportModes':['AIRCRAFT'],'engineTransportModes':['AIRCRAFT'],
                'compartments':[{'loadConfigs':[{'cargoEntry':{'capacity':200,'cargoTypeSet':{'cargoTypesIncluded':['PASSENGERS']}}}]}]},
            'airVehicle': {'topSpeed':200,'maxThrust':100000,'timeToFullThrust':3,'weightEmpty':25000},
            'extent': {'bbMin':[0,0,0],'bbMax':[30,30,10]},
            'emissions': {'noise':{'score':50},'pollution':{'score':25}},
            'cost': {'price':-1}, 'maintenance': {'runningCosts':-1},
        }
        models={'AIR':{'comfort_factor':{'_intercept':-1,'power':.00001}}}
        result=extractor.normalize(meta,'vehicle/plane/test/test.mdl',[{'id':'PASSENGERS','classes':[]}],lambda s:s,models)
        self.assertEqual(result['thrust'],100000)
        self.assertEqual(result['power'],0,'thrust is not electrical/mechanical power in kW')
        self.assertEqual(result['timeToFullThrust'],3)
        self.assertEqual(result['comfort'],50,'AIR regression power feature is raw thrust in N')
        speed=(-.0000203*720**2+.17*720+28.36)/3.6
        running=extractor.round_game(speed*50*(3700/1000*365*4/8))
        self.assertEqual(result['running'],running)
        self.assertEqual(result['purchase'],running*6)

    def test_water_metadata_uses_watts_and_water_cost_formula(self):
        meta = {
            'transportVehicle': {'carrier':'WATER','comfortFactor':0,'loadSpeed':20,
                'transportModes':['SMALL_SHIP'],'engineTransportModes':['SMALL_SHIP'],
                'compartments':[{'loadConfigs':[{'cargoEntry':{'capacity':80,'cargoTypeSet':{'cargoClassesIncluded':['UNIVERSAL']}}}]}]},
            'waterVehicle': {'topSpeed':10,'availPower':800000,'weightEmpty':150000,'weightMaxPayload':24000,'maxRpm':133},
            'extent': {'bbMin':[0,0,0],'bbMax':[30,7,12]},
            'emissions': {'noise':{'score':65},'pollution':{'score':25}},
            'cost': {'price':-1}, 'maintenance': {'runningCosts':-1},
        }
        cargos=[{'id':'LOGS','classes':['UNIVERSAL']}]
        vehicle=extractor.normalize(meta,'vehicle/ship/test/test.mdl',cargos,lambda s:s,{})
        self.assertEqual(vehicle['power'],800)
        self.assertEqual(vehicle['tractiveEffort'],0, 'do not invent rail tractive effort for boats')
        self.assertEqual(vehicle['speed'],36)
        self.assertEqual(vehicle['capacities'],{'LOGS':20})
        # WATER average speed = topSpeed * .65, no locomotive power surcharge.
        running=extractor.round_game(10*.65*20*(3700/1000*365*4/8))
        self.assertEqual(vehicle['running'],running)
        self.assertEqual(vehicle['purchase'],running*6)
        meta['transportVehicle']['loadSpeed']=-1
        models={'WATER':{'load_speed':{'_intercept':1,'max_rpm':.1}}}
        vehicle=extractor.normalize(meta,'vehicle/ship/test/test.mdl',cargos,lambda s:s,models)
        self.assertEqual(vehicle['loadSpeed'],14.5)

    def test_loading_default_and_explicit_regression_are_distinct(self):
        meta = {
            'transportVehicle': {'carrier':'RAIL','comfortFactor':0},
            'landVehicle': {'topSpeed':20,'weightEmpty':10000},
            'extent': {'bbMin':[0,0,0],'bbMax':[10,2,3]},
            'emissions': {'noise':{'score':0},'pollution':{'score':0}},
            'cost': {'price':100}, 'maintenance': {'runningCosts':10},
        }
        models={'RAIL':{'load_speed':{'_intercept':3}}}
        def normalized():
            return extractor.normalize(meta,'vehicle/waggon/test.mdl',[],lambda s:s,models)
        self.assertEqual((normalized()['loadSpeed'],normalized()['loadSpeedSource']),(1,'default'))
        meta['transportVehicle']['loadSpeed']=2
        self.assertEqual((normalized()['loadSpeed'],normalized()['loadSpeedSource']),(2,'explicit'))
        meta['transportVehicle']['loadSpeed']=-1
        self.assertEqual((normalized()['loadSpeed'],normalized()['loadSpeedSource']),(3,'regression'))

    def test_braking_metadata_is_preserved_with_a_legacy_default(self):
        meta = {
            'transportVehicle': {'carrier':'RAIL','comfortFactor':0,'loadSpeed':2},
            'landVehicle': {'topSpeed':20,'weightEmpty':10000,'brakeDeceleration':1.25},
            'extent': {'bbMin':[0,0,0],'bbMax':[10,2,3]},
            'emissions': {'noise':{'score':0},'pollution':{'score':0}},
            'cost': {'price':100}, 'maintenance': {'runningCosts':10},
        }
        vehicle = extractor.normalize(meta,'vehicle/waggon/test.mdl',[],lambda s:s,{})
        self.assertEqual(vehicle['brakeDeceleration'],1.25)
        del meta['landVehicle']['brakeDeceleration']
        vehicle = extractor.normalize(meta,'vehicle/waggon/test.mdl',[],lambda s:s,{})
        self.assertEqual(vehicle['brakeDeceleration'],2.5)

    def test_literal_parser_does_not_execute_lua(self):
        self.assertEqual(extractor.table('return {name = _("Test"), scale = 1/6, values={-2, 3e2}, ["flag"] = true}', 'return'), {'name':'Test','scale':1/6,'values':[-2,300],'flag':True})
        with self.assertRaises(ValueError):
            extractor.table('return {value = execute("anything")}', 'return')

    def test_compartments_sum_but_alternative_load_configs_do_not(self):
        def config(capacity):
            return {'cargoEntry':{'capacity':capacity,'cargoTypeSet':{'cargoClassesIncluded':['BULK'],'cargoTypesExcluded':['SAND']}}}
        tv={'compartments':[{'loadConfigs':[config(80),config(100)]},{'loadConfigs':[config(40)]}]}
        cargos=[{'id':'COAL','classes':['BULK']},{'id':'SAND','classes':['BULK']},{'id':'PASSENGERS','classes':['PASSENGERS']}]
        self.assertEqual(extractor.capacity_by_cargo(tv,cargos),{'COAL':35})

    def test_explicit_cargo_inclusion_and_class_exclusion(self):
        tv={'compartments':[{'loadConfigs':[{'cargoEntry':{'capacity':48,'cargoTypeSet':{'cargoTypesIncluded':['COAL','SAND'],'cargoClassesExcluded':['FORBIDDEN']}}}]}]}
        cargos=[{'id':'COAL','classes':['BULK']},{'id':'SAND','classes':['FORBIDDEN']}]
        self.assertEqual(extractor.capacity_by_cargo(tv,cargos),{'COAL':12})


if __name__=='__main__':
    unittest.main()
