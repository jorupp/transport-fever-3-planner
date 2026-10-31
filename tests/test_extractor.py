"""Small hand-authored fixtures; no game install needed for extractor unit tests."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('extract_tf3', pathlib.Path(__file__).resolve().parents[1]/'scripts/extract_tf3.py')
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


class ExtractorTests(unittest.TestCase):
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
